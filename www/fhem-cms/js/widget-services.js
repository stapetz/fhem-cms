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
    systemMonitorDevices: () => client.jsonlist('TYPE=SYSMON,TYPE=DbLog,TYPE=FileLog'),
    systemLogSizes: () => client.systemLogSizes(),
    conditionSnapshots: (names) => {
      if (!Array.isArray(names) || names.length > 20
        || names.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name))) {
        throw new Error('Ungültige Geräte für Bedingungsvorschau');
      }
      return names.length ? client.jsonlist(names.flatMap(name => [name, `device=${name}`]).join(',')) : Promise.resolve([]);
    },
    listIcons,
    iconUrl: (name) => client.iconUrl(name),
    setCommand: (device, command, value) => client.setCommand(device, command, value),
    setTarget: (widget, value, device) => client.setReading(device || widget.device, widget.readings.target, value),
    listMedia: () => client.listMedia(),
    logReadings: (device, source) => client.logReadings(device, source),
    logDevices: (source, signal) => client.logDevices(source, signal),
    history: (device, reading, range, granularity, source) => client.history(device, reading, range, granularity, source),
    weather: (config) => client.weather(config),
    weatherGeocode: (query) => client.weatherGeocode(query),
    weatherDevices: () => client.weatherDevices(),
    weatherStations: location => client.weatherStations(location),
    weatherTemperature: source => client.weatherTemperature(source),
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
    listAllDevices: async ({ refresh = false } = {}) => {
      if (refresh || !allDevices) allDevices = await client.jsonlist('.*');
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
