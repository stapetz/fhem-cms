import { openAssetManager } from './asset-manager.js';

export function createWidgetServices({ client, listDevices, listAllDevices, listIcons, saveWidget, deleteWidget }) {
  if (!client || [listDevices, listAllDevices, listIcons, saveWidget, deleteWidget]
    .some((service) => typeof service !== 'function')) {
    throw new Error('Vollständige Widget-Dienste erforderlich');
  }
  const assets = {
    assetAction: request => client.assetAction(request),
    uploadAsset: (file, folder, token, options) => client.uploadAsset(file, folder, token, options),
  };
  return {
    listDevices,
    listAllDevices,
    listIcons,
    iconUrl: (name) => client.iconUrl(name),
    setCommand: (device, command, value) => client.setCommand(device, command, value),
    setTarget: (widget, value, device) => client.setReading(device || widget.device, widget.readings.target, value),
    listMedia: () => client.listMedia(),
    logReadings: (device, source) => client.logReadings(device, source),
    history: (device, reading, range, granularity, source) => client.history(device, reading, range, granularity, source),
    uploadMedia: (bytes) => client.uploadMedia(bytes),
    ...assets,
    pickAsset: options => openAssetManager(assets, options),
    saveWidget,
    deleteWidget,
  };
}

export function createSchema5WidgetServices(client) {
  if (!client) throw new Error('FHEM-Client erforderlich');
  let devices;
  let allDevices;
  let icons;
  const unavailable = async () => { throw new Error('Widgetänderungen sind nur im Widgetdialog möglich'); };
  return createWidgetServices({
    client,
    listDevices: async () => {
      if (!devices) devices = await client.jsonlist('TYPE=MAX,TYPE=CUL_HM');
      return devices;
    },
    listAllDevices: async () => {
      if (!allDevices) allDevices = await client.jsonlist('.*');
      return allDevices;
    },
    listIcons: async () => {
      if (!icons) icons = await client.listIcons();
      return icons;
    },
    saveWidget: unavailable,
    deleteWidget: unavailable,
  });
}
