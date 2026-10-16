import httpx
import pytest

from app.core.config import Settings
from app.services.common import digest
from app.services.system_service import _preflight


@pytest.mark.parametrize('denied_role', ['judge', 'teacher', 'localizer'])
def test_preflight_keeps_authentication_failures_isolated_by_role(monkeypatch, denied_role):
    """A bad key must not make other roles on the same model appear unavailable."""
    monkeypatch.setattr('redis.Redis.ping', lambda self: True)
    settings = Settings(
        model_service_url='http://inference.test',
        retrieval_service_url='http://retrieval.test',
        judge_api_key='test-judge',
        teacher_api_key='test-teacher',
        localizer_api_key='test-localizer',
        online_api_key='',
    )
    snapshot = {
        'online_roles': {
            role: {'base_url': 'http://online.test/v1', 'model': 'shared-model'}
            for role in ['judge', 'teacher', 'localizer']
        },
        'retrieval': {},
    }

    def route(request):
        if request.url.host == 'inference.test':
            data = {'ready': True, 'models': [{'role': b} for b in ['diagnosis', 'csc', 'cgec']]}
        elif request.url.host == 'retrieval.test':
            data = {
                'ready': True,
                'config_fingerprint': digest({}),
                **{k: 'test-identity' for k in ['index_fingerprint', 'embedding_fingerprint', 'cpu_fingerprint', 'reranker_fingerprint']},
            }
        else:
            if request.headers['Authorization'] == 'Bearer test-' + denied_role:
                return httpx.Response(401, json={'error': 'unauthorized'})
            return httpx.Response(200, json={'data': [{'id': 'shared-model'}]})
        return httpx.Response(200, json={'status': 'success', 'data': data})

    with httpx.Client(transport=httpx.MockTransport(route)) as http:
        result = _preflight(settings, ['diagnosis', 'csc', 'cgec', 'rag'], {}, snapshot, http)

    assert result['ready'] is False
    for branch, role in [('diagnosis', 'judge'), ('cgec', 'teacher'), ('rag', 'localizer')]:
        assert result['branches'][branch]['ready'] is (role != denied_role)
    assert result['branches']['csc']['ready'] is True
