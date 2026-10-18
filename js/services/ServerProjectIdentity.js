import * as MasterData from '../data/MasterData.js';
import { getProjectFolderName } from '../data/projectUtils.js';
import { touch } from '../data/mergeUtils.js';

// Save before sending data: even a timed-out upload may have reached the server.
export async function ensureServerProjectFolder(project) {
    if (!project) throw new Error('No active project.');
    if (!project.storage_folder) {
        Object.assign(project, touch({ ...project, storage_folder: getProjectFolderName(project) }));
    }
    await MasterData.saveMasterData();
    return project.storage_folder;
}
