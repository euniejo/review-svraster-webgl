import './style.css';
import { Viewer } from './lib/Viewer';
import { Camera } from './lib/Camera';
import { LoadPLY } from './lib/LoadPLY';

// Add these at the top of the file, after imports
let progressContainer: HTMLDivElement;
let progressBarInner: HTMLDivElement;
let progressText: HTMLDivElement;

// Global references
let currentViewer: Viewer;
let currentCamera: Camera;
let mainInfoDisplay: HTMLElement;
let requestedShDegree: number | null = null;

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

// Process PLY data after loading
function processPLYData(plyData: any, fileName: string, loadTime: string, fileSize?: number, infoElement?: HTMLElement) {
  if (plyData.sceneCenter && plyData.sceneExtent) {
    currentViewer.setSceneParameters(plyData.sceneCenter, plyData.sceneExtent);
  }

  const activeShDegree = requestedShDegree ?? plyData.activeShDegree ?? 1;
  currentViewer.setShDegree(activeShDegree);

  currentViewer.loadPointCloud(
    plyData.vertices,
    plyData.sh0Values,
    plyData.octlevels,
    plyData.octpaths,
    plyData.gridValues,
    plyData.shRestValues
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
  
  // Update the main info display
  mainInfoDisplay.textContent = infoText;
  
  // Also update the upload info element if provided
  if (infoElement && infoElement !== mainInfoDisplay) {
    infoElement.textContent = infoText;
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
  // Create the WebGL viewer
  const viewer = new Viewer('app');
  currentViewer = viewer;
  
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
  
  // Get URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const qualityPreset = (urlParams.get('quality') || '').toLowerCase();
  const plyUrl = urlParams.get('url') || '/models/SVRaster/bonsai_og/checkpoints/iter020000_model.ply';
  const showLoadingUI = urlParams.get('showLoadingUI') === 'true';
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
    } else {
      viewer.setDebugRenderMode('normal');
    }
  }

  const stepScale = Number.parseFloat(urlParams.get('stepScale') || '');
  if (Number.isFinite(stepScale)) {
    viewer.setStepScale(stepScale);
  }

  const sortMode = urlParams.get('sort');
  if (sortMode !== null) {
    viewer.setSortingEnabled(sortMode !== '0' && sortMode.toLowerCase() !== 'false' && sortMode.toLowerCase() !== 'off');
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

  // Only add PLY upload UI if showLoadingUI is true
  if (showLoadingUI) {
    // Add UI 
    addPLYUploadUI();
    // Set initial info text
    infoDisplay.textContent = 'Please use the controls in the top right to load a PLY file.';
  } else {
    // Auto-load the PLY file if showLoadingUI is false
    await loadPLYFromUrl(plyUrl, infoDisplay);
  }
});
