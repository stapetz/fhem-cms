export function groupSnapshots(mains, devices) {
  const byName = new Map(devices.map(item => [item.name, item]));
  const groups = new Map();
  for (const name of mains) {
    const device = byName.get(name);
    if (!device) continue;
    groups.set(name, [device, ...devices.filter(item => item.parent === name)
      .sort((a, b) => a.name.localeCompare(b.name))]);
  }
  return groups;
}
