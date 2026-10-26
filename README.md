# Marksman Studios · Animation Library

A local, internal production dashboard for tracking animation briefs, categories, owners, priorities, due dates and approval status. This is an animation management tool, not an ecommerce storefront.

## Run locally

Requires Node.js 20 or later. Excel workbook import also uses Python 3 (standard library only).

```powershell
npm.cmd start
```

Open <http://127.0.0.1:4173>. Records are stored in `data/animations.json` on this machine. Set `PORT` to change the port.

## Catalogue import

Use **Import catalogue** to import `.xlsx`, `.xls` (Excel XML/legacy files are not supported; use `.xlsx`), `.csv`, or `.json`. The Excel reader handles the first worksheet. Include a header row; `Title` or `Animation` is required. Optional recognized columns include Category, Status, Owner/Artist, Priority, Due Date/Deadline, Description/Brief/Notes and Tags. Existing titles are skipped (case-insensitive).

The source workbook `Marksman_Animation_Catalogue.xlsx` was not present in the inspected project or nearby shared animation-library folder. Import it from the dashboard when it becomes available.

## API

- `GET /api/animations` — list records
- `POST /api/animations` — add a record
- `PUT /api/animations/:id` — update a record
- `DELETE /api/animations/:id` — delete a record
- `POST /api/import` — import CSV, JSON or base64-encoded XLSX

The server binds to `127.0.0.1` by default, so the dashboard is available only on the local machine.
