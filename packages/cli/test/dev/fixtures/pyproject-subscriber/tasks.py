# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUntypedFunctionDecorator=false

import json
import os

from celery import Celery


QUEUE_NAME = "tasks-topic"
RESULT_DIR = os.path.join(os.path.dirname(__file__), ".results")


app = Celery("pyproject-subscriber")
app.conf.task_default_queue = QUEUE_NAME


@app.task(name="tasks.process_job")
def process_job(request_id: str, x: int, y: int) -> dict[str, str | int]:
    os.makedirs(RESULT_DIR, exist_ok=True)
    result = {"requestId": request_id, "sum": x + y}
    with open(os.path.join(RESULT_DIR, "result.json"), "w") as f:
        json.dump(result, f)
    return result
