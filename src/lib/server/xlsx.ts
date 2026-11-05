import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './http';

const execute = promisify(execFile);

export async function parseXlsx(buffer: Buffer): Promise<unknown[]> {
  const directory = await mkdtemp(path.join(tmpdir(), 'marksman-import-'));
  const file = path.join(directory, 'workbook.xlsx');
  try {
    await writeFile(file, buffer);
    const script = path.join(process.cwd(), 'scripts', 'read_xlsx.py');
    const candidates = process.env.PYTHON_EXECUTABLE
      ? [process.env.PYTHON_EXECUTABLE]
      : process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
    for (const command of candidates) {
      try {
        const args = command === 'py' ? ['-3', script, file] : [script, file];
        const { stdout } = await execute(command, args, {
          windowsHide: true,
          encoding: 'utf8',
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          timeout: 30_000,
          maxBuffer: 24 * 1024 * 1024,
        });
        return JSON.parse(stdout);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new HttpError(400, 'The workbook could not be read. Upload a valid .xlsx file.');
      }
    }
    throw new HttpError(500, 'Python 3 is required to read Excel workbooks. Set PYTHON_EXECUTABLE if needed.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
