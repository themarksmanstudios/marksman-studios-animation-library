# Marksman Studios · Animation Library

A Next.js App Router application for the Marksman Studios internal motion capture catalogue. It tracks each animation's collection, category, subcategory, region, performers, production status, search tags, hashtags, capture notes, and source references. It is an internal production tracker, not a sales portal.

## Run locally

Requires Node.js 20.9 or later and npm. XLSX imports also require Python 3 (standard library only).

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:4173>. Both development and production servers bind to the loopback address. To choose another port, use `npm run dev -- --port 3000` or `npm start -- --port 3000`.

For production:

```powershell
npm run build
npm start
```

Quality checks:

```powershell
npm run lint
npm run typecheck
npm test
```

## Project structure

```text
src/
  app/
    api/
      animations/
        route.ts             GET and POST
        [id]/route.ts        PUT and DELETE
        [id]/production/      Workspace and Blender-job endpoints
      import/route.ts        Catalogue import endpoint
    globals.css              Global styles and responsive layout
    layout.tsx               Document shell and metadata
    page.tsx                 Home route
  components/
    animations/              Dashboard, statistics, table, and editor
    layout/                  Workspace sidebar
  hooks/                     Client data fetching and mutation state
  lib/
    api-client.ts            Browser HTTP and file-reading helpers
    server/                  Persistence, validation, and import parsing
  types/                     Shared animation types and status constants
integrations/blender/        Blender background worker and local MCP server
public/                      Static assets
scripts/read_xlsx.py         First-worksheet XLSX reader
tests/                      API and catalogue regression tests
data/animations.json        Runtime data, created on first write; Git-ignored
```

Server modules are imported by API route handlers; client components use the HTTP API. Keep Node filesystem and process code under `src/lib/server/`. The `@/*` import alias maps to `src/*`.

## Local data and deployment

The exported studio catalogue is included in `data/animation-catalogue.csv` and seeds the local view with all 262 animations. Editable changes are saved in `data/animations.json`; the source catalogue is kept intact. The first write creates the JSON database from the catalogue. Existing JSON animation records are read with their IDs and fields intact. Writes use an atomic file replacement. Uploaded reference images and videos are stored in the ignored `data/references/` folder.

Optional settings are documented in `.env.example`; copy it to `.env.local` to configure `ANIMATION_DATA_DIR`, `PYTHON_EXECUTABLE`, `BLENDER_EXECUTABLE`, and `ANIMATION_PRODUCTION_DIR`.

Run this app as a **single Node.js server with a writable, persistent data directory**. The JSON store is designed for one local process. Serverless hosts, multiple replicas, or shared network use require a transactional database and appropriate authentication. Static export is not supported because the app uses API routes. XLSX imports require Python and `scripts/read_xlsx.py` on the server; Next.js output tracing includes the script.

## Catalogue import

Use **Import** for `.xlsx`, `.csv`, or `.json`; use **Export catalogue** to download the current collection as CSV. Legacy `.xls` files must first be saved as `.xlsx`. JSON accepts an array or an object containing an `animations` array.

The Excel reader finds the header row in the first worksheet. `Title`, `Animation`, `Animation name`, or `Name` is required. Recognized fields include Animation ID, Category, Subcategory, Collection, Region / scope, Actors/Performers, Search tags, Profile hashtags, Production status, Capture notes, Owner/Artist, Priority, Due Date/Deadline, and Description/Brief/Notes. Catalogues with the `ID`, `Animation`, `Hashtags`, and other columns from the reference dashboard import directly.

Reimports use catalogue IDs (such as `CHAR-001`) when present, otherwise case-insensitive titles, to skip duplicates. Duplicate rows within one import are also skipped. The API accepts JSON request bodies up to 12 MB, including base64 overhead for XLSX files.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/animations` | List records (uncached) |
| POST | `/api/animations` | Create a record |
| PUT | `/api/animations/:id` | Update a record |
| DELETE | `/api/animations/:id` | Delete a record |
| POST | `/api/import` | Import `{ filename, data }`; XLSX data is base64 |
| GET | `/api/export` | Export all records as CSV |
| POST | `/api/animations/:id/references` | Add an HTTP(S) link or upload an image/video |
| DELETE | `/api/animations/:id/references?referenceId=…` | Remove a reference |
| GET / POST | `/api/animations/:id/production` | Read or create an animation's Blender workspace |
| POST | `/api/animations/:id/production/run` | Queue a local Blender background render/export |
| GET / PATCH / POST | `/api/production/settings` | Read/save the master folder or upload a Blender scene template |

Successful create requests return 201; deletes return 204. Validation errors return 400, missing records 404, duplicate create IDs 409, and oversized requests 413. Errors use `{ "error": "message" }`.

## Blender production bridge

The dashboard's **Master folder & scene template** panel lets the operator set a computer-specific root folder, upload the shared `.blend` render scene, and upload an optional `.hdr` or `.exr` HDRI. For GIF rendering, the uploaded HDRI replaces only the image on the scene's connected Environment Texture node. The `.blend` World graph, links, rotation, strength, scene color management, and render engine remain as authored. Without a separate HDRI upload, Blender uses the environment image already referenced by the `.blend`. Generate a workspace only from that animation's detail panel. Each workspace folder uses the animation title (for example, `Namaste Casual`) and the saved Blender project uses the same title (`04-blender-project/Namaste Casual.blend`). Settings are stored locally in `data/production-settings.json`; the folder path must be available and writable by the computer running Next.js. Each animation folder includes raw capture-video, motion-source, Blender project, rendered PNG frames, rig input/output folders, logs, and a `09-final-product` folder containing the GIF preview and playback GLB. Workspace media is ignored by Git.

The uploaded `.blend` scene is the render template and character source; a separate character file is not required. The worker uses that scene character for the playback GLB and GIF, and uses its existing action if no separate motion file is supplied. Each Unreal, Mixamo, or generalized rig animation can be placed in its matching rig-input folder. Blender exports the source animation itself as FBX into both the matching sibling `rig-output` folder and the corresponding `09-final-product/mixamo`, `unreal-engine`, or `general-animations` folder. It removes only the separate head mesh; the source skeleton, head bone, remaining body mesh, and original animation stay intact. Original source files remain untouched in their input folders. Separately, the motion is retargeted onto the approved scene character for the playback GLB used in the 3D viewport. These source FBXs are not retargeted. Only the shared playback GLB is exported; no rig-specific GLBs are created. Common humanoid naming conventions (including Mixamo and Unreal styles) map automatically. For custom names, put `retarget-map.json` in that rig-input folder, mapping source bone names to scene character bone names. Raw video is retained as source media; converting video footage into tracked skeletal motion requires a separate mocap solving step.

The GIF preview samples the entire source action at about 12 frames per second. Its total playback time matches the source action duration, rounded to the GIF format's 10 ms timing units. Longer animations therefore render more preview frames.

The dashboard's Add bone names control opens a shared Mixamo retarget editor beside the catalogue actions. It lists standard Mixamo source bones next to editable character target names, supports JSON map upload, and saves one global map in the selected production root under _templates/mixamo-retarget-map.json. Every Mixamo animation job uses that shared map; local retarget maps are used only when no shared map has been saved; other rig types can use retarget maps in their input folders.

Set `BLENDER_EXECUTABLE` in `.env.local` and restart the app to enable the separate **Create GIF**, **Create playback GLB**, and **Create head-removed FBXs** actions. GIF width and height are configurable per animation; the encoder reduces palette colors toward a 5 MB target while keeping the requested resolution whenever possible. The Box API is intentionally not called yet: the requested GIF + GLB delivery is recorded in each manifest, but Box credentials, endpoint, and upload contract must be supplied before an outbound upload can be implemented.

An optional stdio MCP server exposes `prepare_animation_workspace`, `run_blender_export`, and `get_animation_production_status` to an MCP client. Install its dependency with `python -m pip install -r integrations/blender/requirements.txt`, keep the Next.js app running on `127.0.0.1:4173`, then register `integrations/blender/mcp_server.py` as a Python stdio MCP server. Set `MARKSMAN_APP_URL` if the app uses another local port. The dashboard buttons call the same local API directly.
