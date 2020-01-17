const debug = require('debug')('docker');

// Pull docker image progress
const onProgress = event => {
  if (event.progress) console.log(event.progress);
};

// Pull docker image
const dockerPull = async (docker, image) => new Promise((resolve, reject) => {
  // Pulling docker image
  docker.pull(image, (error, stream) => {
    console.log(`Pulling ${image} image...`);
    if (error) reject(error);
    // Following pull progress
    docker.modem.followProgress(stream, error => {
      if (error) reject(error);
      console.log('Image was successfully pulled.');
      resolve(true);
    }, onProgress);
  });
});

// Get container instance by name
const getContainerByName = async (docker, name) => {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers.find(element => {
      return element.Names[0] === '/' + name ? element : false;
    });
  } catch (error) {
    debug('getContainerByName', error);
    throw error;
  }
};

// Get volume instance by name
const getVolumeByName = async (docker, name) => {
  try {
    const volumes = await docker.listVolumes();
    return volumes.Volumes.find(element => {
      return element.Name === name ? element : false;
    });
  } catch (error) {
    debug('getVolumeByName', error);
    throw error;
  }
};

// Pulling image, creating and strating a container
const startContainer = async (docker, containerData) => {
  try {
    // Pulling image
    await dockerPull(docker, containerData.Image);

    // Starting container
    console.log('Creating and starting container...');
    const container = await docker.createContainer(containerData);
    await container.start();

    return true;
  } catch (error) {
    debug('startContainer', error);
    throw error;
  }
};

// Creating a volume
const createVolume = async (docker, name) => {
  try {
    const volume = await getVolumeByName(docker, name);
    if (volume === undefined) {
      const options = {
        Name: name
      };
      await docker.createVolume(options);
      return true;
    } else {
      debug('createVolume', 'Volume already exists.');
      return false;
    }
  } catch (error) {
    debug('createVolume', error);
    throw error;
  }
};

// Remove 'down' container and start 'up' container
const prepareAndStart = async (docker, containerData, upName, downName, containerUp, containerDown) => {
  try {
    // Settng container name
    containerData.name = upName;

    // We must stop down container if necessary
    if (containerDown !== undefined) {
      console.log(`Stopping ${downName} container...`);
      await removeContainer(docker, downName);
    }

    if (containerUp === undefined) {
      // Starting container
      console.log(`Starting ${upName} container...`);
      await startContainer(docker, containerData);
      return true;
    } else {
      // If container exits but is not in running state
      // We will stop and restart it
      if (containerUp.State !== 'running') {
        console.log(`Restarting container ${containerData.name}...`);
        await removeContainer(docker, containerData.name);
        await startContainer(docker, containerData);
      }

      console.log('Service is already started.');
      return false;
    }
  } catch (error) {
    debug('prepareAndStart', error);
    throw error;
  }
};

// Start passive or active service container
const startServiceContainer = async (docker, type, activeName, passiveName, image, cmd, mountTarget, mountSource) => {
  try {
    // Creating volume
    await createVolume(docker, mountSource);

    // Constructing container data
    const containerData = {
      name: '',
      Image: image,
      Cmd: cmd,
      HostConfig: {
        Mounts: [
          {
            Target: mountTarget,
            Source: mountSource,
            Type: 'volume',
            ReadOnly: false
          }
        ]
      }
    };

    // Get passive and active containers
    const containerPassive = await getContainerByName(docker, passiveName);
    const containerActive = await getContainerByName(docker, activeName);

    // If we want to start active container
    if (type === 'active') {
      return await prepareAndStart(docker, containerData, activeName, passiveName, containerActive, containerPassive);
    // We want to start passive container
    } else {
      return await prepareAndStart(docker, containerData, passiveName, activeName, containerPassive, containerActive);
    }
  } catch (error) {
    debug('startServiceContainer', error);
    throw error;
  }
};

// Stop and remove container
const removeContainer = async (docker, name) => {
  try {
    const containerByName = await getContainerByName(docker, name);
    console.log(`Deleting container ${name}...`);
    if (containerByName !== undefined) {
      const container = await docker.getContainer(containerByName.Id);
      await container.remove({ force: true });
      return true;
    } else {
      console.log(`Container ${name} was not found.`);
      return false;
    }
  } catch (error) {
    debug('removeContainer', error);
    throw error;
  }
};

module.exports = {
  startServiceContainer,
  removeContainer
};