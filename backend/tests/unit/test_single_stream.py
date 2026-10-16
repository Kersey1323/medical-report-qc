import json
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from app.core.exceptions import Cancelled, fail, AppError
from app.domain.results import BranchOutcome, RunConfig, StageContext, StageOutput
from app.schemas.requests import SingleCheck
from app.services import single_service as service
from app.main import create_app


def setup(monkeypatch, executor):
    monkeypatch.setattr(service.system_service, 'config_snapshot', lambda *a: {})
    monkeypatch.setattr(service.system_service, 'preflight', lambda settings, checks, **kw: {
        'ready': True, 'branches': {c: {'ready': True, 'reasons': []} for c in checks}})
    monkeypatch.setattr(service, 'build_transient_executor', lambda *a: executor)
    # Any accidental business persistence would fail the request.
    monkeypatch.setattr('app.db.session.get_factory', lambda: pytest.fail('transient request accessed database'))


def test_stream_continues_after_failed_branch_without_database(monkeypatch):
    calls = []
    class Executor:
        def execute(self, branch, report, context):
            calls.append(branch)
            if branch == 'diagnosis':
                raise fail('response_invalid', '参考诊断返回无效结构', 'diagnosis.generate')
            return BranchOutcome(status='succeeded', finding='no_issue', details={'corrected_text': report.description})
    setup(monkeypatch, Executor())
    app = create_app()
    app.state.session_factory = object()  # skip durable startup recovery only
    with TestClient(app) as client:
        response = client.post('/api/v1/single/stream', json={'description': '合成描述', 'diagnosis': '合成诊断', 'checks': ['diagnosis','csc']})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    events = [json.loads(line) for line in response.text.splitlines()]
    assert calls == ['diagnosis','csc']
    results = [e['data'] for e in events if e['data']['type']=='result']
    assert [e['outcome']['status'] for e in results] == ['failed','succeeded']
    assert results[0]['outcome']['error']['code'] == 'response_invalid'
    assert events[-1]['data']['state']=='partial'
    assert events[-1]['data']['type']=='complete'


def test_validation_and_unhandled_error_keep_200_error_envelope(monkeypatch):
    setup(monkeypatch, object())
    app=create_app();app.state.session_factory=object()
    with TestClient(app) as client:
        bad=client.post('/api/v1/single/stream',json={'description':'x','checks':['diagnosis']})
        assert bad.status_code==200 and bad.json()['status']=='error'
        assert bad.json()['detail']['code']=='input_validation_error'
        monkeypatch.setattr(service.system_service,'config_snapshot',lambda *a: (_ for _ in ()).throw(RuntimeError('config failed')))
        response=client.post('/api/v1/single/stream',json={'description':'synthetic','checks':['csc']})
    last=json.loads(response.text.splitlines()[-1])
    assert last['status']=='error' and last['detail']['message']=='config failed'
    assert response.status_code==200


def test_real_csc_pipeline_uses_transient_stages_and_no_chunk_store(monkeypatch):
    from app.pipelines.csc import CscPipeline
    from app.services.pipeline_executor import PipelineExecutor
    from contracts.inference import InferenceOutput
    class Infer:
        def wait(self, request, heartbeat, trace_id=None):
            heartbeat()
            return InferenceOutput(request_id=request.request_id,text=request.source,raw_text=request.source,
                identity={'role':'csc'},stop_reason='eos',coverage={'checked_chars':len(request.source),'source_chars':len(request.source)})
    setup(monkeypatch, None)
    monkeypatch.setattr(service,'build_transient_executor',lambda settings, stages, stack:PipelineExecutor({'csc':CscPipeline(Infer(), stages)}))
    events=[]
    service.run_single(SingleCheck(description='合成描述。'*35,checks=['csc']),None,str(uuid4()),events.append,Event())
    stages=[e for e in events if e['type']=='stage']
    assert len(stages)>=4  # multiple chunks, each running then succeeded
    result=next(e for e in events if e['type']=='result')['outcome']
    assert result['status']=='succeeded'
    assert result['details']['coverage_chars']==len('合成描述。'*35)


def test_retry_events_and_unknown_remote_not_resubmitted():
    events=[];cancelled=Event()
    stages=service.TransientStages(lambda kind,**v: events.append({'type':kind,**v}),cancelled)
    context=StageContext(uuid4(),1,RunConfig(checks=['csc']),cancelled.is_set)
    calls=[]
    def transient(rid,n):
        calls.append(n)
        if n==1:raise fail('upstream_timeout','暂时不可用','csc.correct',True)
        return StageOutput(payload={'text':'ok'})
    assert stages.run('csc.correct','','',context,transient).payload['text']=='ok'
    assert [e['state'] for e in events]==['running','retrying','running','succeeded']
    calls.clear()
    def unknown(rid,n):
        calls.append(n)
        from contracts.errors import ErrorDetail
        raise AppError(ErrorDetail(code='upstream_timeout',message='状态未知',stage='model.wait',retryable=True,remote_state='unknown'))
    with pytest.raises(AppError):stages.run('csc.correct','','',context,unknown)
    assert calls==[1]


def test_disconnect_stops_later_stages_and_branches(monkeypatch):
    cancelled=Event();calls=[]
    class Executor:
        def execute(self, branch, report, context):
            calls.append(branch);cancelled.set();context.heartbeat()
    setup(monkeypatch,Executor())
    events=[]
    service.run_single(SingleCheck(description='合成描述',diagnosis='合成诊断'),None,str(uuid4()),events.append,cancelled)
    assert calls==['diagnosis']
    assert not any(e['type']=='complete' for e in events)


def test_busy_limit_is_200_error(monkeypatch):
    from app.api.v1 import single
    monkeypatch.setattr(single,'_slots',SimpleNamespace(acquire=lambda **kw:False))
    app=create_app();app.state.session_factory=object()
    with TestClient(app) as client:
        response=client.post('/api/v1/single/stream',json={'description':'合成','checks':['csc']})
    assert response.status_code==200
    assert response.json()['detail']['code']=='single_busy'
