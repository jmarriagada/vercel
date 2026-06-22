import os
import urllib.request

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse

app = FastAPI()


@app.get("/api/binding-info")
def binding_info():
    return {"data_api_url": os.environ.get("DATA_API_URL")}


@app.get("/api/call-binding", response_class=PlainTextResponse)
def call_binding():
    data_api_url = os.environ["DATA_API_URL"]
    with urllib.request.urlopen(f"{data_api_url}items") as resp:
        return resp.read().decode("utf-8")


@app.get("/{full_path:path}")
def echo(full_path: str, request: Request):
    return {
        "service": "backend",
        "received_path": request.url.path,
        "received_query": request.url.query,
    }
