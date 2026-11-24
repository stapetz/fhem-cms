import { createWidgetElement } from './widget-factory.js';

const source = reading => ({device:'Vorschau', reading});
const energyReadings = Object.fromEntries(
  ['pv','home','grid','battery','soc','status','hour','day','month','year','total'].map(key => [key, source(key)]));
const yieldReadings = Object.fromEntries(
  ['hour','day','month','year','total'].map(key => [key, source(key)]));

export const WIDGET_PREVIEWS = {
  thermostat: ['Zeigt und regelt die gewünschte Raumtemperatur.',
    {device:'Vorschau',readings:{actual:'temperature',target:'desiredTemperature',valve:'pct'}}],
  'fhem-value': ['Zeigt einen einzelnen Readingwert mit Einheit.',
    {device:'Vorschau',reading:'temperature',unit:'°C'}],
  'fhem-switch': ['Schaltet ein Gerät und zeigt seinen Zustand.',
    {device:'Vorschau',reading:'state',on:'on',off:'off',showLabel:true,label:'Licht'}],
  'fhem-button': ['Führt einen konfigurierten Gerätebefehl aus.',
    {device:'Vorschau',command:'on',showLabel:true,label:'Start'}],
  'fhem-html': ['Zeigt frei gestaltete HTML-Inhalte mit optionalen Readings.',
    {devices:[],html:'<p>Eigene Anzeige</p><p>Temperatur: 21,5 °C</p>'}],
  'fhem-clock': ['Zeigt Uhrzeit und Datum.',
    {style:'digital',showDate:true,showWeekday:true}],
  'fhem-icon': ['Zeigt ein Symbol abhängig vom Readingwert.',
    {device:'Vorschau',reading:'state',states:[{value:'on',icon:'demo'}]}],
  'fhem-table': ['Zeigt mehrere Readings verschiedener Geräte in einer Tabelle.',
    {rows:[{device:'Vorschau',reading:'temperature',label:'Temperatur',unit:'°C'},
      {device:'Vorschau',reading:'humidity',label:'Luftfeuchte',unit:'%'}]}],
  'fhem-slider': ['Stellt einen numerischen Gerätewert über einen Schieberegler ein.',
    {device:'Vorschau',command:'pct',reading:'pct'}],
  'fhem-select': ['Wählt einen Gerätewert aus vorgegebenen Optionen.',
    {device:'Vorschau',command:'mode',reading:'mode',mode:'dropdown'}],
  'fhem-chart': ['Zeigt den zeitlichen Verlauf eines Readings.',
    {device:'Vorschau',reading:'temperature',unit:'°C'}],
  'fhem-graph': ['Vergleicht mehrere historische Datenreihen als Linien, Stapel oder Tortendiagramm.',
    {chartType:'line',aggregation:'last',range:'24h',granularity:'auto',
      series:[{device:'Vorschau',reading:'temperature',label:'Temperatur',source:'auto',color:'#3b82f6'},
        {device:'Vorschau',reading:'humidity',label:'Luftfeuchte',source:'auto',color:'#f59e0b'}]}],
  'fhem-calllist': ['Zeigt Anrufe mit Status, Kontakt, Zeit und Dauer.',
    {device:'Vorschau',limit:5,columns:['state','party','timestamp','duration']}],
  'fhem-solarflow': ['Zeigt den aktuellen Energiefluss zwischen Solaranlage, Haus, Netz und Speicher.',
    {device:'Vorschau',readings:{pv:'pv',home:'home',grid:'grid',battery:'battery',soc:'soc'}}],
  'fhem-solar-energy': ['Zeigt Energiefluss und Erträge mehrerer Solaranlagen.',
    {readings:energyReadings,sections:[{label:'Dach',readings:yieldReadings}]}],
  'fhem-volvoconnect': ['Zeigt Fahrzeugzustand und verfügbare VolvoConnect-Readings.',
    {device:'Vorschau',showGallery:false}],
  weather: ['Zeigt aktuelles Wetter und eine Wettervorhersage.',
    {config:{dataSource:'fhem_dwd',device:'Vorschau',forecastDays:3,showCurrentDetails:true}}],
  text: ['Zeigt einen formatierten Textbaustein.',
    {html:'<h2>Willkommen</h2><p>Ein eigener Textbaustein.</p>'}],
  'fhem-link': ['Öffnet eine andere CMS-Seite über eine gestaltbare Kachel.',
    {links:[{id:'one',kind:'internal',page:'start',text:'Details',textPosition:'above',
      showText:true,target:'self',grid:{col:1,row:1,w:6,h:3}}]}],
};

const readings = {state:'on',temperature:'21.5',desiredTemperature:'22',humidity:'48',pct:'40',mode:'eco',
  pv:'2500',home:'1000',grid:'1000',battery:'500',soc:'65',status:'OK',
  hour:'1.2',day:'12',month:'120',year:'1200',total:'12345',state_batteryChargeLevel:'83',
  state_electricRange:'320',state_chargingStatus:'DONE',vehicle_descriptions_model:'Volvo EX40'};
for (let index = 1; index <= 5; index++) Object.assign(readings, {
  [`${index}-state`]:'=>',[`${index}-name`]:'Beispiel',
  [`${index}-timestamp`]:'24.11.26 12:00',[`${index}-duration`]:'00:01',
});
const snapshots = new Map([['Vorschau',[{name:'Vorschau',readings,
  sets:'on:noArg off:noArg pct:slider,0,1,100 mode:eco,comfort'}]]]);
const icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Ccircle cx="16" cy="16" r="10" fill="%23f59e0b"/%3E%3C/svg%3E';
const now = Math.floor(Date.now() / 1000);
const services = {
  pages:[{id:'start',title:'Start'}],
  iconUrl:() => icon,
  history:async (device, reading) => ({points: reading === 'humidity'
    ? [[now-7200,35],[now-5400,40],[now-3600,38],[now-1800,43],[now,48]]
    : [[now-7200,19],[now-5400,19.5],[now-3600,20.8],[now-1800,20.2],[now,21.5]],
    summary: reading === 'humidity' ? {last:48,average:40.8} : {last:21.5,average:20.2}}),
  weather:async () => ({source:'fhem_dwd',stationName:'Beispiel',updatedAt:new Date().toISOString(),
    current:{timestamp:new Date().toISOString(),temp:21,humidity:48,windSpeed:12,condition:'cloudy',icon:'cloudy'},
    alerts:[],hourly:[],daily:[{date:new Date().toISOString(),tempMin:14,tempMax:22,precipitationSum:1,
      precipitationProbabilityMax:20,icon:'cloudy'}]}),
};

export function createWidgetPreview(type, title) {
  const preview = WIDGET_PREVIEWS[type];
  if (!preview) throw new Error(`Widget-Vorschau fehlt: ${type}`);
  const [description, fields] = preview;
  const config = {id:'preview',type,title,...structuredClone(fields)};
  const element = createWidgetElement(config, services, snapshots, true);
  element.inert = true;
  element.setAttribute('aria-hidden', 'true');
  return {element, description};
}
