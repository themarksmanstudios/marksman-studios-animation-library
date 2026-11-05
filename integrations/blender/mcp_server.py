"""MCP tools for the local Marksman Next.js production API."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Marksman Blender Production")
APP_URL = os.environ.get("MARKSMAN_APP_URL", "http://127.0.0.1:4173").rstrip("/")


def call_app(path, method="GET"):
    request = Request(APP_URL + path, method=method, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8"))
        except Exception:
            detail = {"error": str(error)}
        raise RuntimeError(detail.get("error", str(error))) from error
    except URLError as error:
        raise RuntimeError("Cannot reach the local Marksman app at " + APP_URL + ". Start npm run dev first.") from error


@mcp.tool()
def prepare_animation_workspace(animation_id: str) -> dict:
    """Create the per-animation Blender, capture, render, GIF, GLB and rig folders."""
    return call_app(f"/api/animations/{quote(animation_id, safe='')}/production", "POST")


@mcp.tool()
def run_blender_export(animation_id: str) -> dict:
    """Queue a configured local Blender background job for an animation workspace."""
    return call_app(f"/api/animations/{quote(animation_id, safe='')}/production/run", "POST")


@mcp.tool()
def get_animation_production_status(animation_id: str) -> dict:
    """Read the current Blender job status and generated output paths."""
    return call_app(f"/api/animations/{quote(animation_id, safe='')}/production", "GET")


if __name__ == "__main__":
    mcp.run(transport="stdio")
