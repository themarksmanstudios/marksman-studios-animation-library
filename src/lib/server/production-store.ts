import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Animation } from '@/types/animation';
import type { ProductionAction, ProductionProject } from '@/types/production';
import { MIXAMO_BONES, mixamoSourceName } from '@/lib/retarget/mixamo-bones';
import { HttpError } from './http';

const PIPELINE = path.join(process.cwd(), 'integrations', 'blender');
const RIGS = [
  { key: 'unreal', label: 'Unreal Engine' },
  { key: 'mixamo', label: 'Mixamo' },
  { key: 'general', label: 'Generalized rig' },
] as const;

function settingsFile() { return path.join(process.env.ANIMATION_DATA_DIR || path.join(process.cwd(), 'data'), 'production-settings.json'); }

function readSettings(): { rootDirectory?: string; templateFile?: string; hdriFile?: string } {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
}

function writeSettings(settings: { rootDirectory?: string; templateFile?: string; hdriFile?: string }) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function getProductionSettings() {
  const settings = readSettings();
  return { rootDirectory: path.resolve(/*turbopackIgnore: true*/ settings.rootDirectory || process.env.ANIMATION_PRODUCTION_DIR || path.join(process.cwd(), 'data', 'production')), templateFile: settings.templateFile || '', hdriFile: settings.hdriFile || '' };
}

export function saveProductionRoot(root: string) {
  const resolved = path.resolve(root.trim());
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) throw new HttpError(400, 'Choose a project folder path, not a drive root.');
  const settings = readSettings();
  writeSettings({ ...settings, rootDirectory: resolved });
  return getProductionSettings();
}

function rootDirectory() {
  return getProductionSettings().rootDirectory;
}

function safeFolderName(value: string) {
  const name = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 120);
  return name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? name : 'Untitled animation';
}

function projectDirectoryForTitle(title: string) {
  return path.join(/*turbopackIgnore: true*/ rootDirectory(), safeFolderName(title));
}

function locateProjectDirectory(id: string) {
  const root = rootDirectory();
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'project.json');
      try { if ((JSON.parse(fs.readFileSync(file, 'utf8')) as ProductionProject).animationId === id) return path.dirname(file); }
      catch { /* Ignore folders that are not animation workspaces. */ }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return null;
}

export function storeSceneTemplate(fileName: string, contents: Buffer) {
  if (!fileName.toLowerCase().endsWith('.blend')) throw new HttpError(400, 'Upload a Blender .blend scene file.');
  if (!contents.length || contents.length > 1024 * 1024 * 1024) throw new HttpError(400, 'The scene file must be between 1 byte and 1 GB.');
  const root = rootDirectory();
  const directory = path.join(root, '_templates');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'preview-scene.blend');
  fs.writeFileSync(target, contents);
  writeSettings({ ...readSettings(), templateFile: target });
  return getProductionSettings();
}

export function storeHdri(fileName: string, contents: Buffer) {
  const extension = path.extname(fileName).toLowerCase();
  if (!['.hdr', '.exr'].includes(extension)) throw new HttpError(400, 'Upload an HDRI environment image in .hdr or .exr format.');
  if (!contents.length || contents.length > 1024 * 1024 * 1024) throw new HttpError(400, 'The HDRI file must be between 1 byte and 1 GB.');
  const directory = path.join(rootDirectory(), '_templates');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `preview-world${extension}`);
  fs.writeFileSync(target, contents);
  writeSettings({ ...readSettings(), hdriFile: target });
  return getProductionSettings();
}

function projectFile(directory: string) {
  return path.join(directory, 'project.json');
}

function completedProductionActions(project: ProductionProject): ProductionAction[] {
  const completed = new Set<ProductionAction>(project.completedActions || []);
  if (project.lastFailedAction) completed.delete(project.lastFailedAction);
  const basename = safeFolderName(project.title);
  const product = path.join(project.directory, '09-final-product');
  if (project.lastFailedAction !== 'glb' && fs.existsSync(path.join(product, 'glb', `${basename}_playback.glb`))) completed.add('glb');
  if (project.lastFailedAction !== 'gif' && fs.existsSync(path.join(product, 'gif', `${basename}_preview.gif`))) completed.add('gif');
  if (project.lastFailedAction !== 'fbx' && ['mixamo', 'unreal-engine', 'general-animations'].some(folder => {
    try { return fs.readdirSync(path.join(product, folder)).some(file => file.toLowerCase().endsWith('.fbx')); }
    catch { return false; }
  })) completed.add('fbx');
  return (['glb', 'gif', 'fbx'] as ProductionAction[]).filter(action => completed.has(action));
}

function writeProject(project: ProductionProject) {
  const directory = path.dirname(projectFile(project.directory));
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${projectFile(project.directory)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, projectFile(project.directory));
}

export function readProductionProject(id: string): ProductionProject | null {
  const directory = locateProjectDirectory(id);
  if (!directory) return null;
  const project = JSON.parse(fs.readFileSync(projectFile(directory), 'utf8')) as ProductionProject;
  return { ...project, completedActions: completedProductionActions(project) };
}

export function listCompletedProductionPreviews(): Record<string, string> {
  const previews: Record<string, string> = {};
  const root = rootDirectory();
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const directory = path.join(root, entry.name);
      let project: ProductionProject;
      try { project = JSON.parse(fs.readFileSync(projectFile(directory), 'utf8')) as ProductionProject; }
      catch { continue; }
      if (!project.animationId || !project.directory || !project.updatedAt) continue;
      if (!['complete', 'partial'].includes(project.status)) continue;
      const gif = project.outputs?.find(output => output.toLowerCase().endsWith('.gif'));
      const glb = project.outputs?.find(output => output.toLowerCase().endsWith('.glb'));
      if (!gif || !glb) continue;
      const projectRoot = path.resolve(project.directory);
      const gifPath = path.resolve(gif);
      const glbPath = path.resolve(glb);
      const gifRelative = path.relative(projectRoot, gifPath);
      const glbRelative = path.relative(projectRoot, glbPath);
      if ([gifRelative, glbRelative].some(relative => !relative || relative.startsWith('..') || path.isAbsolute(relative))) continue;
      if (![gifPath, glbPath].every(file => { try { return fs.statSync(file).isFile(); } catch { return false; } })) continue;
      const encodedGifPath = gifRelative.split(path.sep).map(encodeURIComponent).join('/');
      previews[project.animationId] = `/api/animations/${encodeURIComponent(project.animationId)}/production/assets/${encodedGifPath}?v=${encodeURIComponent(project.updatedAt)}`;
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return previews;
}

function mixamoRetargetMapFile() {
  return path.join(rootDirectory(), '_templates', 'mixamo-retarget-map.json');
}

function normalizeMixamoMap(parsed: Record<string, unknown>) {
  return Object.fromEntries(MIXAMO_BONES.flatMap(bone => {
    const source = mixamoSourceName(bone);
    const target = parsed[source];
    return typeof target === 'string' && target.trim() ? [[source, target.trim()] as const] : [];
  }));
}

function findLegacyMixamoMap(): Record<string, string> {
  try {
    for (const entry of fs.readdirSync(rootDirectory(), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const legacyFile = path.join(rootDirectory(), entry.name, '07-rig-exports', 'mixamo', 'rig-input', 'retarget-map.json');
      try { return normalizeMixamoMap(JSON.parse(fs.readFileSync(legacyFile, 'utf8')) as Record<string, unknown>); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return {};
}

export function readMixamoRetargetMap(): Record<string, string> {
  const mapFile = mixamoRetargetMapFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as Record<string, unknown>;
    return normalizeMixamoMap(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return findLegacyMixamoMap();
    throw error;
  }
}

export function saveMixamoRetargetMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Provide a source-to-target bone mapping object.');
  const input = value as Record<string, unknown>;
  const allowed = new Set(MIXAMO_BONES.map(mixamoSourceName));
  const mapping: Record<string, string> = {};
  for (const [source, rawTarget] of Object.entries(input)) {
    if (!allowed.has(source)) throw new HttpError(400, `Unsupported Mixamo source bone: ${source}`);
    if (typeof rawTarget !== 'string') throw new HttpError(400, `Target bone name for ${source} must be text.`);
    const target = rawTarget.trim();
    if (target.length > 120) throw new HttpError(400, `Target bone name for ${source} is too long.`);
    if (target) mapping[source] = target;
  }
  const mapFile = mixamoRetargetMapFile();
  fs.mkdirSync(path.dirname(mapFile), { recursive: true });
  fs.writeFileSync(mapFile, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
  return mapping;
}

export function getMixamoRetargetMapPath() { return mixamoRetargetMapFile(); }

export function createProductionProject(animation: Animation): ProductionProject {
  const directory = projectDirectoryForTitle(animation.title);
  let occupant: ProductionProject | null = null;
  try { occupant = JSON.parse(fs.readFileSync(projectFile(directory), 'utf8')) as ProductionProject; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (occupant && occupant.animationId !== animation.id) throw new HttpError(409, `Another animation already uses the folder “${path.basename(directory)}”. Give this animation a unique title to create its workspace.`);
  const existing = readProductionProject(animation.id);
  const sameFolder = existing?.directory === directory;
  const now = new Date().toISOString();
  const paths: Record<string, string> = {
    captureVideo: path.join(directory, '01-capture-video'),
    motionSource: path.join(directory, '02-motion-source'),
    motionSourceOutput: path.join(directory, '02-motion-source', 'rig-output'),
    blenderProject: path.join(directory, '04-blender-project'),
    blendFile: path.join(directory, '04-blender-project', `${safeFolderName(animation.title)}.blend`),
    renderFrames: path.join(directory, '05-preview', 'render-frames'),
    finalProduct: path.join(directory, '09-final-product'),
    finalMotionSourceOutput: path.join(directory, '09-final-product', 'general-animations'),
    preview: path.join(directory, '09-final-product', 'gif'),
    glb: path.join(directory, '09-final-product', 'glb'),
    unrealRig: path.join(directory, '07-rig-exports', 'unreal', 'rig-input'),
    unrealSanitized: path.join(directory, '07-rig-exports', 'unreal', 'rig-output'),
    unrealSanitizedFinal: path.join(directory, '09-final-product', 'unreal-engine'),
    mixamoRig: path.join(directory, '07-rig-exports', 'mixamo', 'rig-input'),
    mixamoSanitized: path.join(directory, '07-rig-exports', 'mixamo', 'rig-output'),
    mixamoSanitizedFinal: path.join(directory, '09-final-product', 'mixamo'),
    generalRig: path.join(directory, '07-rig-exports', 'general', 'rig-input'),
    generalSanitized: path.join(directory, '07-rig-exports', 'general', 'rig-output'),
    generalSanitizedFinal: path.join(directory, '09-final-product', 'general-animations'),
    logs: path.join(directory, '08-logs'),
  };
  Object.entries(paths).filter(([key]) => key !== 'blendFile').forEach(([, folder]) => fs.mkdirSync(folder, { recursive: true }));
  if (fs.existsSync(paths.blendFile) && fs.statSync(paths.blendFile).isDirectory()) {
    if (fs.readdirSync(paths.blendFile).length) throw new HttpError(409, `The expected Blender file path is currently a non-empty folder: ${paths.blendFile}. Move its contents before refreshing the workspace.`);
    fs.rmdirSync(paths.blendFile);
  }
  for (const rig of RIGS) {
    fs.writeFileSync(path.join(paths[`${rig.key}Rig`], 'README.txt'), [
      `${rig.label} animated rig input`,
      'Copy an animated .blend, .fbx, .bvh, .glb or .gltf file into this folder.',
      'A source-animation FBX is exported under rig-output and 09-final-product under the matching rig-type folder after removing the head mesh. The source armature, body mesh, and original animation are preserved; the head bone is not removed.',
      rig.key === 'mixamo' ? 'Mixamo uses the shared bone map configured from Add bone names on the dashboard; a local retarget-map.json is used only when no shared map has been saved.' : 'For different source/character bone names, add retarget-map.json with source-bone to scene-character-bone pairs.',
      'Example: {"mixamorig:Hips":"pelvis", "mixamorig:Spine":"spine_01"}',
      'The Blender worker also bakes retargeted motion onto the approved scene character for the separate playback GLB used in the 3D viewport.',
    ].join('\n'), 'utf8');
  }

  const project: ProductionProject = {
    animationId: animation.id,
    title: animation.title,
    directory,
    status: sameFolder && existing?.status === 'complete' ? 'complete' : 'prepared',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    outputs: sameFolder ? existing?.outputs || [] : [],
    gifResolution: sameFolder ? existing?.gifResolution : undefined,
    completedActions: sameFolder ? existing?.completedActions || [] : [],
    lastFailedAction: sameFolder ? existing?.lastFailedAction : null,
    currentAction: null,
  };
  const manifest = {
    version: 1,
    animation: {
      id: animation.id,
      title: animation.title,
      category: animation.category,
      subcategory: animation.subcategory,
      region: animation.region,
      actors: animation.actors,
      tags: animation.tags,
      captureNotes: animation.captureNotes,
    },
    paths,
    templateFile: getProductionSettings().templateFile || null,
    hdriFile: getProductionSettings().hdriFile || null,
    targets: RIGS.map(rig => ({ key: rig.key, label: rig.label, inputDirectory: paths[`${rig.key}Rig`], sourceOutputDirectory: paths[`${rig.key}Sanitized`], finalSourceOutputDirectory: paths[`${rig.key}SanitizedFinal`] })),
    delivery: { preview: 'GIF', playback: 'GLB', destination: 'Box API (not configured)' },
    updatedAt: now,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(directory, 'README.txt'), [
    `${animation.id} - ${animation.title}`,
    '',
    'Production workspace input steps:',
    `1. Copy raw capture videos into: ${paths.captureVideo}`,
    `2. Copy tracked motion data (FBX, BVH, GLB or GLTF) into: ${paths.motionSource}`,
    '3. The approved mascot/character should already be present in the uploaded Blender scene template.',
    '4. Put each rig-specific animated file into its matching rig-input folder under 07-rig-exports. A source-animation FBX without the head mesh is written to its matching rig-output folder and to 09-final-product under Mixamo, Unreal Engine, or General; input files are preserved.',
    '5. Configure shared Mixamo source-to-character bone names with Add bone names in the dashboard. Other rigs can use a retarget-map.json in their rig-input folder.',
    '6. Run the ordered production actions: Create playback GLB, then Create GIF, then Create head-removed FBXs. Each action unlocks after its predecessor succeeds.',
    '',
    'Final portal assets are grouped under 09-final-product: GIF preview, playback GLB, and the original-animation FBXs without head meshes under mixamo/, unreal-engine/, and general-animations/. The FBXs are also copied into each 07-rig-exports/{rig}/rig-output folder; they are not retargeted onto the studio character. Only the shared playback GLB is exported; there are no per-rig GLBs.',
    'A separate character asset is not required when the uploaded Blender scene contains the approved character.',
    'Optional rig retargeting and Box delivery require rig assets and API configuration.',
  ].join('\n'), 'utf8');
  writeProject(project);
  return project;
}

export function enqueueBlenderJob(id: string, action: ProductionAction, resolution?: { width: number; height: number }): ProductionProject {
  const project = readProductionProject(id);
  if (!project) throw new HttpError(409, 'Create the Blender production workspace first.');
  if (project.status === 'queued' || project.status === 'running') throw new HttpError(409, 'A Blender job is already in progress.');
  const completed = new Set(project.completedActions || []);
  if (action === 'gif' && !completed.has('glb')) throw new HttpError(409, 'Create the playback GLB successfully before rendering the GIF.');
  if (action === 'fbx' && (!completed.has('glb') || !completed.has('gif'))) throw new HttpError(409, 'Create the playback GLB and GIF successfully before exporting head-removed FBXs.');
  const executable = process.env.BLENDER_EXECUTABLE;
  if (!executable) throw new HttpError(503, 'Blender is not configured. Set BLENDER_EXECUTABLE in .env.local, then restart the app.');
  if (!fs.existsSync(executable)) throw new HttpError(503, 'The configured Blender executable was not found. Check BLENDER_EXECUTABLE.');
  const manifest = path.join(project.directory, 'manifest.json');
  const manifestData = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>;
  manifestData.templateFile = getProductionSettings().templateFile || null;
  manifestData.hdriFile = getProductionSettings().hdriFile || null;
  manifestData.mixamoRetargetMapFile = getMixamoRetargetMapPath();
  manifestData.jobAction = action;
  manifestData.renderSettings = { ...((manifestData.renderSettings as Record<string, unknown> | undefined) || {}), ...(resolution ? { gifWidth: resolution.width, gifHeight: resolution.height } : {}) };
  const manifestPaths = manifestData.paths as Record<string, string> | undefined;
  const blendFile = manifestPaths?.blendFile;
  if (blendFile && fs.existsSync(blendFile) && fs.statSync(blendFile).isDirectory()) {
    if (fs.readdirSync(blendFile).length) throw new HttpError(409, `The expected Blender file path is currently a non-empty folder: ${blendFile}. Move its contents before retrying the job.`);
    fs.rmdirSync(blendFile);
  }
  fs.writeFileSync(manifest, `${JSON.stringify(manifestData, null, 2)}\n`, 'utf8');
  const worker = path.join(PIPELINE, 'process_animation.py');
  if (!fs.existsSync(worker)) throw new HttpError(503, 'The Blender worker script is missing from integrations/blender.');

  const next = { ...project, ...(resolution ? { gifResolution: resolution } : {}), currentAction: action, status: 'queued' as const, updatedAt: new Date().toISOString(), lastError: undefined };
  writeProject(next);
  try {
    const child = spawn(executable, ['--background', '--python', worker, '--', manifest], {
      cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, MARKSMAN_PRODUCTION_ROOT: rootDirectory() },
    });
    child.once('error', error => {
      const failed = readProductionProject(id);
      if (failed) writeProject({ ...failed, status: 'failed', currentAction: null, lastFailedAction: action, updatedAt: new Date().toISOString(), lastError: error.message });
    });
    child.unref();
  } catch (error) {
    const failed = { ...next, status: 'failed' as const, currentAction: null, lastFailedAction: action, updatedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : String(error) };
    writeProject(failed);
    throw new HttpError(500, 'Could not start Blender. Check the local server log.');
  }
  return next;
}
