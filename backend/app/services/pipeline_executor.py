from app.core.exceptions import fail


class PipelineExecutor:
    def __init__(self, pipelines):
        self.pipelines = pipelines

    def execute(self, branch, report, context):
        if branch not in self.pipelines:
            raise fail(
                "input_validation_error", "未配置该质控流程", "pipeline.dispatch"
            )
        return self.pipelines[branch].run(report, context)


def build_executor(settings, factory):
    from app.clients.inference import InferenceClient
    from app.clients.online import OnlineClient
    from app.clients.retrieval import RetrievalClient
    from app.services.execution_service import StageRunner
    from app.services.retrieval_service import RetrievalService
    from app.db.repositories.chunks import CscChunkStore
    from app.pipelines.diagnosis import DiagnosisPipeline
    from app.pipelines.csc import CscPipeline
    from app.pipelines.cgec import CgecPipeline
    from app.pipelines.localization import LocalizationPipeline

    inference = InferenceClient(settings)
    online = OnlineClient(settings)
    stages = StageRunner(factory)
    retrieval = RetrievalService(RetrievalClient(settings), stages, factory)
    return PipelineExecutor(
        {
            "diagnosis": DiagnosisPipeline(inference, online, stages),
            "csc": CscPipeline(inference, stages, CscChunkStore(factory)),
            "cgec": CgecPipeline(retrieval, online, inference, stages),
            "rag": LocalizationPipeline(retrieval, online, stages),
        }
    )
