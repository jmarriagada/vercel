import json

from tasks import process_job  # pyright: ignore[reportImplicitRelativeImport]


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") == "POST" and environ.get("PATH_INFO") == "/enqueue":
        request_id = "dev-celery"
        result = process_job.delay(request_id, 19, 23)
        body = json.dumps({"requestId": request_id, "taskId": result.id}).encode()
        start_response(
            "200 OK",
            [
                ("Content-Type", "application/json"),
                ("Content-Length", str(len(body))),
            ],
        )
        return [body]

    body = b"not found"
    start_response(
        "404 Not Found",
        [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))],
    )
    return [body]
