from fastapi import FastAPI

app = FastAPI()


@app.get("/items")
def items():
    return {"service": "data_api", "items": ["a", "b", "c"]}
