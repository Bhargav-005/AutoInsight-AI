from types import SimpleNamespace
from uuid import uuid4


def test_recovery_recognizes_the_mapped_active_worker_as_live(monkeypatch):
    from app.api import research as research_api

    run_id = uuid4()
    expected_job_id = f"research-{run_id}"

    class LiveWorker:
        def get_state(self):
            return "busy"

        def get_current_job_id(self):
            return expected_job_id

    class EmptyQueue:
        name = "autoinsight"
        job_ids = []

    class EmptyRegistry:
        def __init__(self, *args, **kwargs):
            pass

        def get_job_ids(self):
            return []

    monkeypatch.setattr(research_api, "queue", lambda *args, **kwargs: EmptyQueue())
    monkeypatch.setattr(research_api.Worker, "all", lambda **kwargs: [LiveWorker()])
    for registry_name in (
        "StartedJobRegistry",
        "DeferredJobRegistry",
        "ScheduledJobRegistry",
        "FailedJobRegistry",
        "FinishedJobRegistry",
        "CanceledJobRegistry",
    ):
        monkeypatch.setattr(
            research_api,
            registry_name,
            type(registry_name, (EmptyRegistry,), {}),
        )

    run = SimpleNamespace(id=run_id, plan_json={})
    assert research_api._rq_job_state(run, object(), object()) == "active_worker"
