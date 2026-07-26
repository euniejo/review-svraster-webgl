import { DistanceSorter } from '../lib/DistanceSorter';
import { MortonSorter } from '../lib/MortonSorter';
import { ViewDepthSorter } from '../lib/ViewDepthSorter';
import { mat4, vec3 } from 'gl-matrix';

// Define message types
interface SortRequest {
  type: 'sort';
  positions: Float32Array;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  sceneTransformMatrix: Float32Array; // Add transform matrix
  sortMetric?: 'distance' | 'depth' | 'morton';
  compositeMode?: 'back' | 'front';
  octpathLow?: Uint32Array;
  octpathHigh?: Uint32Array;
}

interface SortResponse {
  type: 'sorted';
  indices: Uint32Array;
  sortTime: number;
}

// Web Worker context
const ctx: Worker = self as any;

// Handle incoming messages
ctx.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as SortRequest;
  
  if (data.type === 'sort') {
    const sortMetric = data.sortMetric === 'distance' || data.sortMetric === 'morton'
      ? data.sortMetric
      : 'depth';
    console.log(`SortWorker: Starting ${sortMetric} sort for ${data.positions.length / 3} voxels`);
    
    const startTime = performance.now();
    
    let indices: Uint32Array;
    if (sortMetric === 'morton') {
      if (!data.octpathLow || !data.octpathHigh) {
        throw new Error('Morton sorting requested without complete octpaths');
      }
      const inverseTransform = mat4.invert(
        mat4.create(),
        data.sceneTransformMatrix as mat4
      );
      if (!inverseTransform) {
        throw new Error('Scene transform is not invertible');
      }
      const localCamera = vec3.transformMat4(
        vec3.create(),
        data.cameraPosition,
        inverseTransform
      );
      indices = MortonSorter.sortVoxels(
        data.positions,
        [localCamera[0], localCamera[1], localCamera[2]],
        data.octpathLow,
        data.octpathHigh
      );
    } else {
      // Transform positions before camera-distance sorting.
      const transformedPositions = new Float32Array(data.positions.length);
    
    // Apply the scene transformation to each position
    for (let i = 0; i < data.positions.length / 3; i++) {
      const x = data.positions[i * 3];
      const y = data.positions[i * 3 + 1];
      const z = data.positions[i * 3 + 2];
      
      // Apply transformation matrix
      transformedPositions[i * 3]     = x * data.sceneTransformMatrix[0] + 
                                         y * data.sceneTransformMatrix[4] + 
                                         z * data.sceneTransformMatrix[8] + 
                                         data.sceneTransformMatrix[12];
      transformedPositions[i * 3 + 1] = x * data.sceneTransformMatrix[1] + 
                                         y * data.sceneTransformMatrix[5] + 
                                         z * data.sceneTransformMatrix[9] + 
                                         data.sceneTransformMatrix[13];
      transformedPositions[i * 3 + 2] = x * data.sceneTransformMatrix[2] + 
                                         y * data.sceneTransformMatrix[6] + 
                                         z * data.sceneTransformMatrix[10] + 
                                         data.sceneTransformMatrix[14];
    }
    
      indices = sortMetric === 'depth'
        ? ViewDepthSorter.sortVoxels(transformedPositions, data.cameraPosition, data.cameraTarget)
        : DistanceSorter.sortVoxels(transformedPositions, data.cameraPosition);
    }

    const sortedFrontToBack = sortMetric === 'morton';
    const needsReverse = data.compositeMode === 'front' ? !sortedFrontToBack : sortedFrontToBack;
    if (needsReverse) {
      indices.reverse();
    }
    
    const sortTime = performance.now() - startTime;
    console.log(
      `SortWorker: ${sortMetric} sort complete in ${sortTime.toFixed(2)}ms, ` +
      `returning ${indices.length} indices`
    );
    
    // Send back sorted indices
    const response: SortResponse = {
      type: 'sorted',
      indices,
      sortTime
    };
    
    ctx.postMessage(response, [response.indices.buffer]);
  }
});

// Let the main thread know we're ready
console.log('SortWorker: Initialized and ready');
ctx.postMessage({ type: 'ready' });
