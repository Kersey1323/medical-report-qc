import httpx
from contracts.retrieval import CandidateSet
from app.clients.http import unwrap, transport_error


class RetrievalClient:
    def __init__(self, settings, http=None):
        self.url = settings.retrieval_service_url.rstrip("/")
        self.http = http or httpx.Client(
            timeout=httpx.Timeout(300, connect=3),
            transport=httpx.HTTPTransport(retries=0),
        )

    def health(self):
        try:
            return unwrap(
                self.http.get(self.url + "/health/ready", timeout=3), "retrieval.health"
            )
        except httpx.RequestError as exc:
            raise transport_error(exc, "retrieval.health") from exc

    def retrieve(self, request):
        try:
            return CandidateSet.model_validate(
                unwrap(
                    self.http.post(
                        self.url + "/internal/v1/retrieve",
                        json=request.model_dump(mode="json"),
                    ),
                    "retrieval",
                )
            )
        except httpx.RequestError as exc:
            raise transport_error(exc, "retrieval") from exc
