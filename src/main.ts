import './style.css';
import { Viewer } from './lib/Viewer';
import { Camera } from './lib/Camera';
import { LoadPLY, type PLYData } from './lib/LoadPLY';
import { getRequiredShRestCount } from './lib/SphericalHarmonics';

// Add these at the top of the file, after imports
let progressContainer: HTMLDivElement;
let progressBarInner: HTMLDivElement;
let progressText: HTMLDivElement;

// Global references
let currentViewer: Viewer;
let currentCamera: Camera;
let mainInfoDisplay: HTMLElement;
let requestedShDegree: number | null = null;
let activeSampleCount = 3;

type CompareMode = 'sh13' | 'viewdir' | 'tuning' | 'preset';
type PresetGroup = 'baseline' | 'quality' | 'diagnostic';

const VIEW_TUNING_KEYS = [
  'quality',
  'inspect',
  'sh',
  'disableSh2',
  'sh1map',
  'sh2map',
  'shViewDir',
  'shDebug',
  'shDiffScale',
  'renderDebug',
  'stepScale',
  'sort',
  'sortMode',
  'compositeMode',
  'densityMode',
  'densityTransfer',
  'densityThreshold',
  'rawDensityBias',
  'rawDensityScale',
  'minOct',
  'maxOct',
  'minGridMean',
  'blend',
  'depth',
  'cull',
  'voxelScale',
  'integrationMode',
  'rayMode',
  'samples',
  'renderScale'
] as const;

interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

interface CompareCameraMessage {
  type: 'compare-camera';
  channelId: string;
  pane: 'left' | 'right';
  state: CameraState;
}

interface LocalPlyReadyMessage {
  type: 'local-ply-ready';
  pane: 'left' | 'right';
}

interface LoadLocalPlyMessage {
  type: 'load-local-ply';
  file: File;
}

interface TestPreset {
  id: string;
  label: string;
  description: string;
  group: PresetGroup;
  overrides: Record<string, string | null>;
}

function createViewerOverrides(
  changes: Record<string, string | null> = {}
): Record<string, string | null> {
  const overrides: Record<string, string | null> = {
    compare: null,
    viewPreset: null
  };
  for (const key of VIEW_TUNING_KEYS) {
    overrides[key] = null;
  }
  return { ...overrides, ...changes };
}

const TEST_PRESETS: TestPreset[] = [
  {
    id: 'original',
    label: 'Viewer Baseline (SH1)',
    description: '뷰어 기본값을 사용하는 SH1 기준 화면',
    group: 'baseline',
    overrides: createViewerOverrides({ sh: '1' })
  },
  {
    id: 'linear',
    label: 'Linear Only',
    description: 'density transfer만 explin에서 linear로 변경',
    group: 'quality',
    overrides: createViewerOverrides({ sh: '1', densityTransfer: 'linear' })
  },
  {
    id: 'samples',
    label: 'Samples x8',
    description: '복셀 내부 ray integration 샘플을 3개에서 8개로 증가',
    group: 'quality',
    overrides: createViewerOverrides({ sh: '1', samples: '8' })
  },
  {
    id: 'sh3',
    label: 'SH3 Only',
    description: '다른 렌더링 값은 유지하고 SH 차수만 3으로 증가',
    group: 'quality',
    overrides: createViewerOverrides({ sh: '3' })
  },
  {
    id: 'flat',
    label: 'Flat Density',
    description: 'trilinear 보간 대신 8개 corner density의 평균값을 사용',
    group: 'quality',
    overrides: createViewerOverrides({ sh: '1', densityMode: 'flat' })
  },
  {
    id: 'linear-samples',
    label: 'Linear + Samples x8',
    description: 'linear transfer와 samples=8의 조합 효과 확인',
    group: 'quality',
    overrides: createViewerOverrides({ sh: '1', densityTransfer: 'linear', samples: '8' })
  },
  {
    id: 'alpha',
    label: 'Alpha Debug',
    description: '최종 alpha 누적값을 흑백으로 표시',
    group: 'diagnostic',
    overrides: createViewerOverrides({ sh: '1', renderDebug: 'alpha' })
  },
  {
    id: 'albedo',
    label: 'Albedo Debug',
    description: 'alpha discard를 통과한 fragment의 SH1 색상값을 불투명으로 표시',
    group: 'diagnostic',
    overrides: createViewerOverrides({
      sh: '1',
      renderDebug: 'albedo',
      blend: 'off',
      depth: 'on'
    })
  },
  {
    id: 'thickness',
    label: 'Thickness Debug',
    description: '카메라 ray가 각 복셀을 통과한 두께를 표시',
    group: 'diagnostic',
    overrides: createViewerOverrides({ sh: '1', renderDebug: 'thickness' })
  },
  {
    id: 'solid',
    label: 'Solid Debug',
    description: 'density를 제외하고 복셀 proxy geometry의 화면 점유만 표시',
    group: 'diagnostic',
    overrides: createViewerOverrides({
      sh: '1',
      renderDebug: 'solid',
      blend: 'off',
      depth: 'on'
    })
  }
];

// Create a function to initialize the progress bar
function createProgressBar() {
  progressContainer = document.createElement('div');
  progressContainer.style.position = 'absolute';
  progressContainer.style.top = '50%';
  progressContainer.style.left = '50%';
  progressContainer.style.transform = 'translate(-50%, -50%)';
  progressContainer.style.padding = '20px';
  progressContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  progressContainer.style.color = 'white';
  progressContainer.style.fontFamily = 'sans-serif';
  progressContainer.style.borderRadius = '10px';
  progressContainer.style.textAlign = 'center';
  progressContainer.style.display = 'none';

  progressText = document.createElement('div');
  progressText.style.marginBottom = '10px';
  progressText.textContent = 'Loading PLY file...';

  const progressBarOuter = document.createElement('div');
  progressBarOuter.style.width = '200px';
  progressBarOuter.style.height = '20px';
  progressBarOuter.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  progressBarOuter.style.borderRadius = '10px';
  progressBarOuter.style.overflow = 'hidden';

  progressBarInner = document.createElement('div');
  progressBarInner.style.width = '0%';
  progressBarInner.style.height = '100%';
  progressBarInner.style.backgroundColor = '#4CAF50';

  progressBarOuter.appendChild(progressBarInner);
  progressContainer.appendChild(progressText);
  progressContainer.appendChild(progressBarOuter);
  document.body.appendChild(progressContainer);
}

// Helper function to update progress
function updateProgress(progress: number) {
  const percentage = Math.round(progress * 100);
  // Remove transition for 100% to ensure it completes
  if (percentage === 100) {
    progressBarInner.style.transition = 'none';
  }
  
  // Update both the width and text in the same frame
  const width = `${percentage}%`;
  const text = `Loading PLY file... ${percentage}%`;
  
  // Ensure both updates happen in the same frame
  requestAnimationFrame(() => {
    progressBarInner.style.width = width;
    progressText.textContent = text;
  });
}

// Also, let's reset the progress bar when starting a new load
function resetProgress() {
  progressBarInner.style.width = '0%';
  progressText.textContent = 'Loading PLY file... 0%';
}

function parseIndexList(value: string | null, expectedLength: number, maxIndex: number): number[] | null {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v));

  if (parsed.length !== expectedLength) {
    return null;
  }

  for (const v of parsed) {
    if (v < 0 || v > maxIndex) {
      return null;
    }
  }

  return parsed;
}

function getCameraState(camera: Camera): CameraState {
  const position = camera.getPosition();
  const target = camera.getTarget();
  return {
    position: [position[0], position[1], position[2]],
    target: [target[0], target[1], target[2]]
  };
}

function serializeCameraState(state: CameraState): string {
  return [...state.position, ...state.target].map((value) => value.toFixed(4)).join(',');
}

function parseCameraState(value: string | null): CameraState | null {
  if (!value) {
    return null;
  }
  const values = value.split(',').map((item) => Number.parseFloat(item));
  if (values.length !== 6 || values.some((item) => !Number.isFinite(item))) {
    return null;
  }
  return {
    position: [values[0], values[1], values[2]],
    target: [values[3], values[4], values[5]]
  };
}

function applyCameraState(camera: Camera, state: CameraState) {
  camera.setPosition(state.position[0], state.position[1], state.position[2]);
  camera.setTarget(state.target[0], state.target[1], state.target[2]);
}

function buildComparePaneUrl(
  baseParams: URLSearchParams,
  pane: 'left' | 'right',
  channelId: string,
  overrides: Record<string, string | null>
): string {
  const params = new URLSearchParams(baseParams);
  params.delete('compare');
  params.delete('compareChild');
  params.delete('comparePane');
  params.delete('compareChannel');
  params.delete('comparePreset');
  params.delete('compareCamera');
  params.delete('viewPreset');

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  params.set('compareChild', '1');
  params.set('comparePane', pane);
  params.set('compareChannel', channelId);
  // The comparison parent owns local file selection and forwards it to both panes.
  params.set('localFile', '1');
  return `${window.location.pathname}?${params.toString()}`;
}

function applyViewerDefaults(viewer: Viewer): void {
  viewer.setDisableSh2(false);
  viewer.setUseVoxelToCameraShDir(false);
  viewer.setShComparisonMode('normal');
  viewer.setShDirDiffScale(8.0);
  viewer.setDebugRenderMode('normal');
  viewer.setRenderScale(1.0);
  viewer.setStepScale(100.0);
  viewer.setSortingEnabled(true);
  viewer.setSortMetric('depth');
  viewer.setCompositeMode('back');
  viewer.setDensityMode('trilinear');
  viewer.setDensityTransferMode('explin');
  viewer.setDensityThreshold(0.0);
  viewer.setBlendingEnabled(true);
  viewer.setDepthTestEnabled(false);
  viewer.setCullingEnabled(true);
  viewer.setVoxelScaleMultiplier(1.0);
  viewer.setRawDensityBias(2.0);
  viewer.setRawDensityScale(0.2);
  viewer.setVisibleOctlevelRange(0, 16);
  viewer.setMinGridMean(-1000.0);
  viewer.setExactRayMode(true);
}

function createComparePane(
  label: string,
  src: string,
  pane: 'left' | 'right'
): { wrapper: HTMLDivElement; iframe: HTMLIFrameElement } {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.minWidth = '0';
  wrapper.style.background = '#000';
  wrapper.style.overflow = 'hidden';
  wrapper.style.borderLeft = pane === 'right' ? '1px solid rgba(255,255,255,0.14)' : 'none';

  const badge = document.createElement('div');
  badge.className = 'compare-pane-badge';
  badge.textContent = label;
  badge.style.position = 'absolute';
  badge.style.bottom = '12px';
  badge.style.left = '12px';
  badge.style.zIndex = '2';
  badge.style.padding = '6px 10px';
  badge.style.borderRadius = '999px';
  badge.style.background = 'rgba(0, 0, 0, 0.65)';
  badge.style.color = 'white';
  badge.style.fontFamily = 'sans-serif';
  badge.style.fontSize = '12px';
  badge.style.letterSpacing = '0.04em';
  badge.style.textTransform = 'uppercase';

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = label;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.display = 'block';

  wrapper.appendChild(iframe);
  wrapper.appendChild(badge);
  return { wrapper, iframe };
}

function initCompareSync(
  channelId: string,
  leftFrame: HTMLIFrameElement,
  rightFrame: HTMLIFrameElement
): () => CameraState | null {
  let latestState: CameraState | null = null;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const data = event.data as CompareCameraMessage | undefined;
    if (!data || data.type !== 'compare-camera' || data.channelId !== channelId) {
      return;
    }

    latestState = data.state;
    const target = data.pane === 'left' ? rightFrame.contentWindow : leftFrame.contentWindow;
    target?.postMessage(data, window.location.origin);
  });
  return () => latestState;
}

function addPresetCompareController(
  urlParams: URLSearchParams,
  channelId: string,
  rightPane: { wrapper: HTMLDivElement; iframe: HTMLIFrameElement },
  getLatestCameraState: () => CameraState | null,
  host: HTMLElement
): void {
  const selectedPreset =
    TEST_PRESETS.find((preset) => preset.id === urlParams.get('comparePreset')) ?? TEST_PRESETS[1];

  const panel = document.createElement('div');
  panel.className = 'compare-preset-panel';

  const select = document.createElement('select');
  select.className = 'compare-preset-select';
  select.ariaLabel = 'Right pane test preset';
  select.title = selectedPreset.description;

  const groupLabels: Record<Exclude<PresetGroup, 'baseline'>, string> = {
    quality: 'Quality Tests',
    diagnostic: 'Render Diagnostics'
  };
  for (const group of ['quality', 'diagnostic'] as const) {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = groupLabels[group];
    TEST_PRESETS.filter((preset) => preset.group === group).forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      option.selected = preset.id === selectedPreset.id;
      optionGroup.appendChild(option);
    });
    select.appendChild(optionGroup);
  }

  const rightBadge = rightPane.wrapper.querySelector('div');

  const setPreset = (presetId: string) => {
    const preset = TEST_PRESETS.find((item) => item.id === presetId) ?? TEST_PRESETS[1];
    select.value = preset.id;
    select.title = preset.description;
    const cameraState = getLatestCameraState();
    const overrides = {
      ...preset.overrides,
      compareCamera: cameraState ? serializeCameraState(cameraState) : null
    };
    rightPane.iframe.src = buildComparePaneUrl(urlParams, 'right', channelId, overrides);
    if (rightBadge) {
      rightBadge.textContent = `Right: ${preset.label}`;
    }
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set('compare', 'preset');
    nextParams.set('comparePreset', preset.id);
    window.history.replaceState({}, '', `${window.location.pathname}?${nextParams.toString()}`);
  };

  select.addEventListener('change', () => setPreset(select.value));
  panel.appendChild(select);
  host.appendChild(panel);
}

function setupCompareLayout(compareMode: CompareMode, urlParams: URLSearchParams) {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('App root not found');
  }

  document.body.style.margin = '0';
  document.body.style.background = '#050505';
  document.body.classList.add('compare-shell');
  root.innerHTML = '';
  root.className = 'compare-grid';
  root.style.display = 'grid';
  root.style.gridTemplateColumns = '1fr 1fr';
  root.style.background = '#050505';

  const channelId = `${compareMode}-${Date.now()}`;
  const selectedPreset =
    TEST_PRESETS.find((preset) => preset.id === urlParams.get('comparePreset')) ?? TEST_PRESETS[1];
  const paneConfigs =
    compareMode === 'sh13'
      ? [
          {
            pane: 'left' as const,
            label: 'Left: SH1',
            src: buildComparePaneUrl(
              urlParams,
              'left',
              channelId,
              createViewerOverrides({ sh: '1' })
            )
          },
          {
            pane: 'right' as const,
            label: 'Right: SH3',
            src: buildComparePaneUrl(
              urlParams,
              'right',
              channelId,
              createViewerOverrides({ sh: '3' })
            )
          }
        ]
      : compareMode === 'viewdir'
        ? [
          {
            pane: 'left' as const,
            label: 'Left: SH3 CameraToVoxel',
            src: buildComparePaneUrl(
              urlParams,
              'left',
              channelId,
              createViewerOverrides({ sh: '3' })
            )
          },
          {
            pane: 'right' as const,
            label: 'Right: SH3 VoxelToCamera',
            src: buildComparePaneUrl(
              urlParams,
              'right',
              channelId,
              createViewerOverrides({ sh: '3', shViewDir: 'voxeltocamera' })
            )
          }
        ]
        : compareMode === 'tuning'
          ? [
            {
              pane: 'left' as const,
              label: 'Left: Linear Only',
              src: buildComparePaneUrl(
                urlParams,
                'left',
                channelId,
                createViewerOverrides({ sh: '1', densityTransfer: 'linear' })
              )
            },
            {
              pane: 'right' as const,
              label: 'Right: Samples x8 Only',
              src: buildComparePaneUrl(
                urlParams,
                'right',
                channelId,
                createViewerOverrides({ sh: '1', samples: '8' })
              )
            }
          ]
        : [
            {
              pane: 'left' as const,
              label: 'Left: Viewer Baseline (SH1)',
              src: buildComparePaneUrl(
                urlParams,
                'left',
                channelId,
                createViewerOverrides({ sh: '1' })
              )
            },
            {
              pane: 'right' as const,
              label: `Right: ${selectedPreset.label}`,
              src: buildComparePaneUrl(
                urlParams,
                'right',
                channelId,
                selectedPreset.overrides
              )
            }
          ];

  const [leftPane, rightPane] = paneConfigs.map((config) =>
    createComparePane(config.label, config.src, config.pane)
  );

  root.appendChild(leftPane.wrapper);
  root.appendChild(rightPane.wrapper);

  const toolbar = document.createElement('div');
  toolbar.className = 'compare-toolbar';

  const header = document.createElement('div');
  header.className = 'compare-header';
  header.textContent = 'Split Compare: drag either side to sync both cameras';
  document.body.appendChild(toolbar);
  toolbar.appendChild(header);

  const getLatestCameraState = initCompareSync(channelId, leftPane.iframe, rightPane.iframe);
  addLocalPlyLoader(leftPane.iframe, rightPane.iframe, toolbar);

  if (compareMode === 'preset') {
    addPresetCompareController(urlParams, channelId, rightPane, getLatestCameraState, toolbar);
  }
}

function addLocalPlyLoader(
  leftFrame: HTMLIFrameElement,
  rightFrame: HTMLIFrameElement,
  host: HTMLElement
): void {
  const panel = document.createElement('div');
  panel.className = 'local-ply-loader';

  const label = document.createElement('label');
  label.textContent = 'Local PLY';
  label.style.fontWeight = '600';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ply,application/octet-stream';
  input.className = 'local-ply-input';

  const status = document.createElement('span');
  status.textContent = 'Select a PLY file to load both panes.';
  status.title = status.textContent;
  status.className = 'local-ply-status';

  panel.append(label, input, status);
  host.prepend(panel);

  let selectedFile: File | null = null;
  const sendFile = (frame: HTMLIFrameElement) => {
    if (!selectedFile || !frame.contentWindow) {
      return;
    }
    const message: LoadLocalPlyMessage = { type: 'load-local-ply', file: selectedFile };
    frame.contentWindow.postMessage(message, window.location.origin);
  };

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source === window) {
      return;
    }
    const data = event.data as LocalPlyReadyMessage | undefined;
    if (data?.type !== 'local-ply-ready') {
      return;
    }
    if (event.source === leftFrame.contentWindow) {
      sendFile(leftFrame);
    } else if (event.source === rightFrame.contentWindow) {
      sendFile(rightFrame);
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    selectedFile = file;
    status.textContent = `${file.name} selected. Loading both panes locally...`;
    status.title = status.textContent;
    sendFile(leftFrame);
    sendFile(rightFrame);
  });
}

function setupCompareChildSync(camera: Camera, urlParams: URLSearchParams) {
  const channelId = urlParams.get('compareChannel');
  const pane = urlParams.get('comparePane');
  if (!channelId || (pane !== 'left' && pane !== 'right') || window.parent === window) {
    return;
  }

  let lastBroadcastKey = '';
  let suppressBroadcastUntil = 0;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const data = event.data as CompareCameraMessage | undefined;
    if (!data || data.type !== 'compare-camera' || data.channelId !== channelId || data.pane === pane) {
      return;
    }

    applyCameraState(camera, data.state);
    lastBroadcastKey = serializeCameraState(data.state);
    suppressBroadcastUntil = performance.now() + 150;
  });

  const publishLoop = () => {
    const state = getCameraState(camera);
    const key = serializeCameraState(state);
    if (key !== lastBroadcastKey && performance.now() >= suppressBroadcastUntil) {
      const message: CompareCameraMessage = {
        type: 'compare-camera',
        channelId,
        pane,
        state
      };
      window.parent.postMessage(message, window.location.origin);
      lastBroadcastKey = key;
    }
    requestAnimationFrame(publishLoop);
  };

  requestAnimationFrame(publishLoop);
}

function renderModelInfo(
  element: HTMLElement,
  infoText: string,
  shDegree: number,
  requiredRestCount: number,
  availableRestCount: number,
  sampleCount: number
) {
  element.replaceChildren();

  const details = document.createElement('div');
  details.textContent = infoText;
  details.style.whiteSpace = 'pre-line';

  const shStatus = document.createElement('div');
  shStatus.textContent =
    `SH${shDegree} | coefficients ${requiredRestCount}/${availableRestCount} | ray samples ${sampleCount}`;
  shStatus.title =
    `Using ${requiredRestCount} of ${availableRestCount} SH rest coefficients available in the PLY`;
  shStatus.style.display = 'inline-flex';
  shStatus.style.marginTop = '8px';
  shStatus.style.padding = '4px 7px';
  shStatus.style.border = '1px solid rgba(134, 239, 172, 0.55)';
  shStatus.style.borderRadius = '4px';
  shStatus.style.background = 'rgba(20, 83, 45, 0.72)';
  shStatus.style.color = '#dcfce7';
  shStatus.style.fontFamily = 'monospace';
  shStatus.style.fontSize = '0.9em';

  element.append(details, shStatus);
}

// Process PLY data after loading
function processPLYData(plyData: PLYData, fileName: string, loadTime: string, fileSize?: number, infoElement?: HTMLElement) {
  if (plyData.sceneCenter && plyData.sceneExtent) {
    currentViewer.setSceneParameters(plyData.sceneCenter, plyData.sceneExtent);
  }

  const activeShDegree = requestedShDegree ?? plyData.activeShDegree ?? 1;
  const requiredRestCount = getRequiredShRestCount(activeShDegree);
  if (plyData.shRestCount < requiredRestCount) {
    throw new Error(
      `SH degree ${activeShDegree} requires ${requiredRestCount} f_rest values per vertex, ` +
      `but this PLY contains ${plyData.shRestCount}`
    );
  }
  currentViewer.setShDegree(activeShDegree);

  currentViewer.loadPointCloud(
    plyData.vertices,
    plyData.sh0Values,
    plyData.octlevels,
    plyData.octpaths,
    plyData.gridValues,
    plyData.shRestValues,
    plyData.octpathHighs
  );

  let octlevelInfo = '';
  if (plyData.octlevels && plyData.octlevels.length > 0) {
    const minOct = plyData.octlevels.reduce((min: number, val: number) => val < min ? val : min, plyData.octlevels[0]);
    const maxOct = plyData.octlevels.reduce((max: number, val: number) => val > max ? val : max, plyData.octlevels[0]);
    octlevelInfo = `\nOctlevels: ${minOct} to ${maxOct}`;
  }

  const sizeInfo = fileSize ? `\nSize: ${(fileSize / (1024 * 1024)).toFixed(2)} MB` : '';
  const infoText = `Loaded: ${fileName}
    Voxels: ${plyData.vertexCount.toLocaleString()}${sizeInfo}
    Load time: ${loadTime}s${octlevelInfo}`;
  
  renderModelInfo(
    mainInfoDisplay,
    infoText,
    activeShDegree,
    requiredRestCount,
    plyData.shRestCount,
    activeSampleCount
  );
  
  // Also update the upload info element if provided
  if (infoElement && infoElement !== mainInfoDisplay) {
    renderModelInfo(
      infoElement,
      infoText,
      activeShDegree,
      requiredRestCount,
      plyData.shRestCount,
      activeSampleCount
    );
  }

  // Keep the model in its original orientation by default.
  // Hardcoded transforms/camera presets can place non-pumpkin scenes outside the frustum.
  if (plyData.sceneCenter && plyData.sceneExtent) {
    const defaultDistance = Math.min(Math.max(plyData.sceneExtent * 0.02, 2.5), 10.0);
    currentCamera.setTarget(
      plyData.sceneCenter[0],
      plyData.sceneCenter[1],
      plyData.sceneCenter[2]
    );
    currentCamera.setPosition(
      plyData.sceneCenter[0],
      plyData.sceneCenter[1],
      plyData.sceneCenter[2] + defaultDistance
    );
  }
}

// Load PLY from URL
async function loadPLYFromUrl(url: string, infoElement: HTMLElement) {
  try {
    progressContainer.style.display = 'block';
    resetProgress();
    
    const startTime = performance.now();
    const plyData = await LoadPLY.loadFromUrl(url, (progress) => {
      updateProgress(progress);
    });
    const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
    
    progressContainer.style.display = 'none';
    
    const fileName = url.split('/').pop() || 'remote-ply';
    processPLYData(plyData, fileName, loadTime, undefined, infoElement);
    
    return true;
  } catch (error: any) {
    progressContainer.style.display = 'none';
    console.error('Error loading PLY from URL:', error);
    infoElement.textContent = `Error loading PLY: ${error.message}`;
    
    // Update the main info display too if different from infoElement
    if (infoElement !== mainInfoDisplay) {
      mainInfoDisplay.textContent = `Error loading PLY: ${error.message}`;
    }
    
    return false;
  }
}

// Load PLY from File
async function loadPLYFromFile(file: File, infoElement: HTMLElement) {
  try {
    const startTime = performance.now();
    const plyData = await LoadPLY.loadFromFile(file);
    const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
    
    processPLYData(plyData, file.name, loadTime, file.size, infoElement);
    
    return true;
  } catch (error: any) {
    console.error('Error loading PLY from file:', error);
    infoElement.textContent = `Error loading PLY: ${error.message}`;
    
    // Update the main info display too if different from infoElement
    if (infoElement !== mainInfoDisplay) {
      mainInfoDisplay.textContent = `Error loading PLY: ${error.message}`;
    }
    
    return false;
  }
}

/**
 * Add some basic UI controls for the demo
 */
function addControls() {
  // Create a simple control panel
  const controls = document.createElement('div');
  controls.style.position = 'absolute';
  controls.style.top = '10px';
  controls.style.left = '10px';
  controls.style.padding = '10px';
  controls.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  controls.style.color = 'white';
  controls.style.fontFamily = 'sans-serif';
  controls.style.borderRadius = '5px';
  controls.style.fontSize = '14px';
  
  // Check if device is mobile
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  // Different instructions based on device type
  const controlInstructions = isMobile ? `
    <h3 style="margin: 0 0 5px 0; font-size: 1em;">Controls</h3>
    <ul style="padding-left: 15px; margin: 0;">
      <li style="margin: 2px 0;">1 finger drag: orbit</li>
      <li style="margin: 2px 0;">2 finger drag: pan/zoom</li>
    </ul>
  ` : `
    <h3 style="margin: 0 0 5px 0; font-size: 1em;">Controls</h3>
    <ul style="padding-left: 15px; margin: 0;">
      <li style="margin: 2px 0;">LClick + drag: orbit</li>
      <li style="margin: 2px 0;">RClick + drag: pan</li>
      <li style="margin: 2px 0;">Scroll: zoom</li>
      <li style="margin: 2px 0;">WASD/Arrow Keys: move</li>
    </ul>
  `;
  
  controls.innerHTML = `
    <h2 style="margin: 0 0 5px 0; font-size: 1.2em;">WebGL SVRaster Viewer</h2>
    <a href="https://github.com/samuelm2/svraster-webgl" style="text-decoration: underline; color: white; font-size: 0.85em; display: block; margin-bottom: 10px;">GitHub</a>
    ${controlInstructions}
    <div id="model-info" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.3); font-size: 0.85em;"></div>
  `;

  // Add media query for mobile devices
  if (isMobile) {
    controls.style.fontSize = '12px';
    controls.style.padding = '8px';
    controls.style.maxWidth = '150px';
  }

  // Add the controls to the document
  document.body.appendChild(controls);
  
  return document.getElementById('model-info')!;
}

/**
 * Add PLY file upload UI
 */
function addPLYUploadUI() {
  // Create a file upload container
  const uploadContainer = document.createElement('div');
  uploadContainer.style.position = 'absolute';
  uploadContainer.style.top = '10px';
  uploadContainer.style.right = '10px';
  uploadContainer.style.padding = '10px';
  uploadContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  uploadContainer.style.color = 'white';
  uploadContainer.style.fontFamily = 'sans-serif';
  uploadContainer.style.borderRadius = '5px';
  
  // Update the UI to have buttons for both inputs
  uploadContainer.innerHTML = `
    <h3>Load PLY Model</h3>
    <div style="display: flex; gap: 5px; margin-bottom: 10px;">
      <input type="file" id="ply-upload" accept=".ply" 
        style="flex-grow: 1; padding: 5px; border-radius: 3px; border: 1px solid #ccc;">
      <button id="load-file" style="padding: 5px 10px; border-radius: 3px; border: 1px solid #ccc; cursor: pointer;">
        Load File
      </button>
    </div>
    <div style="display: flex; gap: 5px; margin-bottom: 10px;">
      <input type="text" id="ply-url" placeholder="Enter PLY URL" 
        style="padding: 5px; border-radius: 3px; border: 1px solid #ccc; flex-grow: 1;">
      <button id="load-url" style="padding: 5px 10px; border-radius: 3px; border: 1px solid #ccc; cursor: pointer;">
        Load URL
      </button>
    </div>
    <div id="ply-info" style="margin-top: 10px; font-size: 12px;"></div>
  `;
  
  document.body.appendChild(uploadContainer);
  
  // Get UI elements
  const fileInput = document.getElementById('ply-upload') as HTMLInputElement;
  const fileButton = document.getElementById('load-file') as HTMLButtonElement;
  const urlInput = document.getElementById('ply-url') as HTMLInputElement;
  const urlButton = document.getElementById('load-url') as HTMLButtonElement;
  const infoElement = document.getElementById('ply-info')!;

  // Handle URL input
  urlButton.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert('Please enter a URL');
      return;
    }

    try {
      urlButton.disabled = true;
      urlButton.textContent = 'Loading...';
      infoElement.textContent = 'Loading PLY from URL...';
      
      await loadPLYFromUrl(url, infoElement);
    } finally {
      urlButton.disabled = false;
      urlButton.textContent = 'Load URL';
    }
  });

  // Handle file input
  fileButton.addEventListener('click', async () => {
    if (!fileInput.files || fileInput.files.length === 0) {
      alert('Please select a file first');
      return;
    }

    const file = fileInput.files[0];
    try {
      fileButton.disabled = true;
      fileButton.textContent = 'Loading...';
      infoElement.textContent = 'Loading PLY file...';
      
      await loadPLYFromFile(file, infoElement);
    } finally {
      fileButton.disabled = false;
      fileButton.textContent = 'Load File';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const compareMode = urlParams.get('compare');
  const isCompareChild = urlParams.get('compareChild') === '1';
  if (!isCompareChild) {
    const effectiveCompareMode: CompareMode =
      compareMode === 'sh13' ||
      compareMode === 'viewdir' ||
      compareMode === 'tuning' ||
      compareMode === 'preset'
        ? compareMode
        : 'preset';
    setupCompareLayout(effectiveCompareMode, urlParams);
    return;
  }

  const integrationMode =
    urlParams.get('integrationMode')?.toLowerCase() === 'jittered' ? 'jittered' : 'reference';
  const quality = (urlParams.get('quality') || '').toLowerCase();
  const fallbackSamples = integrationMode === 'reference'
    ? 3
    : quality === 'detail' ? 12 : quality === 'preview' ? 4 : 8;
  const requestedSamples = Number.parseInt(urlParams.get('samples') || `${fallbackSamples}`, 10);
  activeSampleCount = Math.max(1, Math.min(Number.isFinite(requestedSamples) ? requestedSamples : fallbackSamples, 64));

  // Create the WebGL viewer
  const viewer = new Viewer('app');
  currentViewer = viewer;
  applyViewerDefaults(viewer);
  viewer.setReferenceIntegration(integrationMode === 'reference');
  
  // Get direct access to the camera
  const camera = viewer.getCamera();
  currentCamera = camera;
  
  // Configure the camera for a nice view
  camera.setPosition(0, 0, 5);   // Position away from the scene
  camera.setTarget(0, 0, 0);     // Look at the center
  
  // Handle window resize events
  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    viewer.resize(width, height);
  });
  
  const qualityPreset = (urlParams.get('quality') || '').toLowerCase();
  const inspectPreset = (urlParams.get('inspect') || '').toLowerCase();
  const rayMode = urlParams.get('rayMode')?.toLowerCase() === 'legacy' ? 'legacy' : 'exact';
  viewer.setExactRayMode(rayMode === 'exact');
  const plyUrl = urlParams.get('url') || '/models/SVRaster/bonsai_og/checkpoints/iter020000_model.ply';
  const showLoadingUI = urlParams.get('showLoadingUI') === 'true';
  const waitForLocalFile = urlParams.get('localFile') === '1';
  const shDegreeParam = urlParams.get('sh');
  if (shDegreeParam !== null) {
    const shDegree = parseInt(shDegreeParam, 10);
    requestedShDegree = Number.isFinite(shDegree) ? shDegree : null;
    if (requestedShDegree !== null) {
      viewer.setShDegree(requestedShDegree);
    }
  }

  if (qualityPreset === 'preview') {
    viewer.setRenderScale(0.7);
    viewer.setVoxelScaleMultiplier(0.98);
  } else if (qualityPreset === 'detail') {
    viewer.setRenderScale(1.0);
    viewer.setDensityTransferMode('linear');
    viewer.setDensityThreshold(0.08);
    viewer.setVoxelScaleMultiplier(0.92);
    viewer.setStepScale(120.0);
  }

  if (inspectPreset === 'direction') {
    viewer.setShComparisonMode('dirdiff');
    viewer.setShDirDiffScale(14.0);
    viewer.setRenderScale(1.0);
  } else if (inspectPreset === 'coverage') {
    viewer.setDebugRenderMode('thickness');
    viewer.setBlendingEnabled(false);
    viewer.setDepthTestEnabled(true);
    viewer.setCullingEnabled(false);
    viewer.setVoxelScaleMultiplier(1.03);
  } else if (inspectPreset === 'leaks') {
    viewer.setDebugRenderMode('alpha');
    viewer.setBlendingEnabled(true);
    viewer.setDepthTestEnabled(false);
    viewer.setCullingEnabled(false);
    viewer.setVoxelScaleMultiplier(1.03);
  }

  const disableSh2 = urlParams.get('disableSh2');
  if (disableSh2 !== null) {
    viewer.setDisableSh2(disableSh2 !== '0' && disableSh2.toLowerCase() !== 'false');
  }

  const shViewDir = urlParams.get('shViewDir');
  if (shViewDir !== null) {
    viewer.setUseVoxelToCameraShDir(shViewDir.toLowerCase() === 'voxeltocamera');
  }

  const shDebug = urlParams.get('shDebug');
  if (shDebug !== null) {
    const normalizedShDebug = shDebug.toLowerCase();
    if (normalizedShDebug === 'degdiff13') {
      viewer.setShComparisonMode('degdiff13');
    } else if (normalizedShDebug === 'dirdiff') {
      viewer.setShComparisonMode('dirdiff');
    } else {
      viewer.setShComparisonMode('normal');
    }
  }

  const shDiffScale = Number.parseFloat(urlParams.get('shDiffScale') || '');
  if (Number.isFinite(shDiffScale)) {
    viewer.setShDirDiffScale(shDiffScale);
  }

  const renderDebug = urlParams.get('renderDebug');
  if (renderDebug !== null) {
    const normalizedRenderDebug = renderDebug.toLowerCase();
    if (normalizedRenderDebug === 'alpha') {
      viewer.setDebugRenderMode('alpha');
    } else if (normalizedRenderDebug === 'thickness') {
      viewer.setDebugRenderMode('thickness');
    } else if (normalizedRenderDebug === 'solid') {
      viewer.setDebugRenderMode('solid');
    } else if (normalizedRenderDebug === 'rawdensity') {
      viewer.setDebugRenderMode('rawdensity');
    } else if (normalizedRenderDebug === 'albedo') {
      viewer.setDebugRenderMode('albedo');
    } else {
      viewer.setDebugRenderMode('normal');
    }
  }

  const stepScale = Number.parseFloat(urlParams.get('stepScale') || '');
  if (Number.isFinite(stepScale)) {
    viewer.setStepScale(stepScale);
  }

  const sortMode = (urlParams.get('sortMode') || urlParams.get('sort') || 'depth').toLowerCase();
  const sortingDisabled = sortMode === '0' || sortMode === 'false' || sortMode === 'off';
  const activeSortMode = sortingDisabled
    ? 'off'
    : sortMode === 'distance' ? 'distance' : sortMode === 'morton' ? 'morton' : 'depth';
  const requestedCompositeMode = urlParams.get('compositeMode')?.toLowerCase();
  const activeCompositeMode = requestedCompositeMode === 'front' ||
    (requestedCompositeMode !== 'back' && activeSortMode === 'morton')
    ? 'front'
    : 'back';
  viewer.setSortingEnabled(!sortingDisabled);
  viewer.setCompositeMode(activeCompositeMode);
  if (!sortingDisabled) {
    viewer.setSortMetric(
      activeSortMode === 'distance' ? 'distance' : activeSortMode === 'morton' ? 'morton' : 'depth'
    );
  }

  const densityMode = urlParams.get('densityMode');
  if (densityMode !== null) {
    viewer.setDensityMode(densityMode.toLowerCase() === 'flat' ? 'flat' : 'trilinear');
  }

  const densityTransfer = urlParams.get('densityTransfer');
  if (densityTransfer !== null) {
    const normalizedDensityTransfer = densityTransfer.toLowerCase();
    if (normalizedDensityTransfer === 'linear') {
      viewer.setDensityTransferMode('linear');
    } else if (normalizedDensityTransfer === 'exp') {
      viewer.setDensityTransferMode('exp');
    } else {
      viewer.setDensityTransferMode('explin');
    }
  }

  const densityThreshold = Number.parseFloat(urlParams.get('densityThreshold') || '');
  if (Number.isFinite(densityThreshold)) {
    viewer.setDensityThreshold(densityThreshold);
  }

  const rawDensityBias = Number.parseFloat(urlParams.get('rawDensityBias') || '');
  if (Number.isFinite(rawDensityBias)) {
    viewer.setRawDensityBias(rawDensityBias);
  }

  const rawDensityScale = Number.parseFloat(urlParams.get('rawDensityScale') || '');
  if (Number.isFinite(rawDensityScale)) {
    viewer.setRawDensityScale(rawDensityScale);
  }

  const minOct = Number.parseInt(urlParams.get('minOct') || '', 10);
  const maxOct = Number.parseInt(urlParams.get('maxOct') || '', 10);
  if (Number.isFinite(minOct) || Number.isFinite(maxOct)) {
    viewer.setVisibleOctlevelRange(
      Number.isFinite(minOct) ? minOct : 0,
      Number.isFinite(maxOct) ? maxOct : 16
    );
  }

  const minGridMean = Number.parseFloat(urlParams.get('minGridMean') || '');
  if (Number.isFinite(minGridMean)) {
    viewer.setMinGridMean(minGridMean);
  }

  const renderScale = Number.parseFloat(urlParams.get('renderScale') || '');
  if (Number.isFinite(renderScale)) {
    viewer.setRenderScale(renderScale);
  }

  const blendMode = urlParams.get('blend');
  if (blendMode !== null) {
    viewer.setBlendingEnabled(blendMode !== '0' && blendMode.toLowerCase() !== 'false' && blendMode.toLowerCase() !== 'off');
  }

  const depthMode = urlParams.get('depth');
  if (depthMode !== null) {
    viewer.setDepthTestEnabled(depthMode === '1' || depthMode.toLowerCase() === 'true' || depthMode.toLowerCase() === 'on');
  }

  const cullMode = urlParams.get('cull');
  if (cullMode !== null) {
    viewer.setCullingEnabled(!(cullMode === '0' || cullMode.toLowerCase() === 'false' || cullMode.toLowerCase() === 'off'));
  }

  const voxelScale = Number.parseFloat(urlParams.get('voxelScale') || '');
  if (Number.isFinite(voxelScale)) {
    viewer.setVoxelScaleMultiplier(voxelScale);
  }

  const sh1Map = parseIndexList(urlParams.get('sh1map'), 3, 2);
  if (sh1Map) {
    viewer.setSh1BasisOrder(sh1Map);
  }

  const sh2Map = parseIndexList(urlParams.get('sh2map'), 5, 4);
  if (sh2Map) {
    viewer.setSh2BasisOrder(sh2Map);
  }

  // Add UI controls and get info element
  const infoDisplay = addControls();
  mainInfoDisplay = infoDisplay;
  
  // Create progress bar
  createProgressBar();

  if (waitForLocalFile) {
    infoDisplay.textContent = 'Waiting for a local PLY file selection...';
    window.addEventListener('message', async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as LoadLocalPlyMessage | undefined;
      if (data?.type !== 'load-local-ply' || !(data.file instanceof File)) {
        return;
      }
      await loadPLYFromFile(data.file, infoDisplay);
    });
  } else if (showLoadingUI) {
    // Add UI 
    addPLYUploadUI();
    // Set initial info text
    infoDisplay.textContent = 'Please use the controls in the top right to load a PLY file.';
  } else {
    // Auto-load the PLY file if showLoadingUI is false
    await loadPLYFromUrl(plyUrl, infoDisplay);
  }

  const initialCameraState = parseCameraState(urlParams.get('compareCamera'));
  if (initialCameraState) {
    applyCameraState(camera, initialCameraState);
  }
  setupCompareChildSync(camera, urlParams);

  if (waitForLocalFile && window.parent !== window) {
    const pane = urlParams.get('comparePane');
    if (pane === 'left' || pane === 'right') {
      const message: LocalPlyReadyMessage = { type: 'local-ply-ready', pane };
      window.parent.postMessage(message, window.location.origin);
    }
  }
});
