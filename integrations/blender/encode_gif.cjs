const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const [framesDirectory, outputPath, expectedCountArg, fpsArg, durationMsArg] = process.argv.slice(2);
  if (!framesDirectory || !outputPath) throw new Error('Usage: node encode_gif.cjs <frames-directory> <output.gif> [frame-count] [fps] [source-duration-ms]');
  const frames = fs.readdirSync(framesDirectory)
    .filter(name => /^frame_\d+\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(name => path.join(framesDirectory, name));
  if (!frames.length) throw new Error('No rendered PNG frames found.');
  const expectedCount = Number(expectedCountArg || frames.length);
  const fps = Number(fpsArg || 12);
  if (frames.length !== expectedCount) throw new Error(`Expected ${expectedCount} frames, found ${frames.length}.`);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('GIF frame rate must be positive.');
  const durationMs = Number(durationMsArg || frames.length * 1000 / fps);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Source animation duration must be positive.');
  // GIF delays are centiseconds. Distribute rounded ticks over every frame
  // so the complete animation ends at the source clip's duration.
  const durationCs = Math.max(frames.length, Math.round(durationMs / 10));
  const delays = frames.map((_, index) =>
    (Math.round((index + 1) * durationCs / frames.length) - Math.round(index * durationCs / frames.length)) * 10);

  const metadata = await sharp(frames[0]).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Could not read PNG frame dimensions.');
  const targetBytes = Number(process.argv[7] || 5 * 1024 * 1024);
  if (!Number.isFinite(targetBytes) || targetBytes < 1) throw new Error('GIF target size must be positive bytes.');
  const inputs = await Promise.all(frames.map(file => sharp(file).png().toBuffer()));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  let chosen, chosenMetadata, chosenSize, chosenColours;
  for (const colours of [192, 128, 96, 64, 48, 32]) {
    const temporaryPath = `${outputPath}.tmp-${colours}.gif`;
    fs.rmSync(temporaryPath, { force: true });
    await sharp({
      create: {
        width: metadata.width,
        height: metadata.height * frames.length,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        pageHeight: metadata.height,
      },
    }).composite(inputs.map((input, index) => ({ input, left: 0, top: metadata.height * index })))
      .gif({ loop: 0, delay: delays, effort: 10, colours, dither: 0 })
      .toFile(temporaryPath);

    const encoded = await sharp(temporaryPath).metadata();
    if (encoded.pages !== frames.length || encoded.delay?.length !== frames.length) {
      fs.rmSync(temporaryPath, { force: true });
      throw new Error(`GIF encoding incomplete: expected ${frames.length} pages, found ${encoded.pages || 0}.`);
    }
    const encodedDuration = encoded.delay.reduce((sum, delay) => sum + delay, 0);
    if (encodedDuration !== durationCs * 10) {
      fs.rmSync(temporaryPath, { force: true });
      throw new Error(`GIF duration mismatch: expected ${durationCs * 10} ms, encoded ${encodedDuration} ms.`);
    }
    chosen = temporaryPath;
    chosenMetadata = encoded;
    chosenSize = fs.statSync(temporaryPath).size;
    chosenColours = colours;
    if (chosenSize <= targetBytes) break;
  }
  fs.renameSync(chosen, outputPath);
  for (const colours of [192, 128, 96, 64, 48, 32]) {
    const temporaryPath = `${outputPath}.tmp-${colours}.gif`;
    if (temporaryPath !== chosen) fs.rmSync(temporaryPath, { force: true });
  }
  process.stdout.write(JSON.stringify({ path: outputPath, frames: chosenMetadata.pages, width: chosenMetadata.width, height: chosenMetadata.pageHeight, durationMs: chosenMetadata.delay.reduce((sum, delay) => sum + delay, 0), sizeBytes: chosenSize, colours: chosenColours }));
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
