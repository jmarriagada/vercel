from fastapi import FastAPI

from tasks import process_job  # pyright: ignore[reportImplicitRelativeImport]


app = FastAPI()


@app.post("/enqueue")
def enqueue():
    request_id = "dev-celery"
    result = process_job.delay(request_id, 19, 23)
    return {"requestId": request_id, "taskId": result.id}
