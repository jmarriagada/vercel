import json

from vercel.workers import send


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") == "POST" and environ.get("PATH_INFO") == "/enqueue":
        result = send("tasks-topic", {"action": "test", "value": 42})
        body = json.dumps({"messageId": result.get("messageId")}).encode()
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
