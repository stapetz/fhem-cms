use strict;
use warnings;
use Test::More;
use JSON::PP ();
require './FHEM/01_FHEMCMS.pm';

my $widget = {
    id => 'system', type => 'system-monitor', systemDevice => 'Local',
    title => 'System', grid => {col => 1, row => 2, w => 6, h => 8},
};
my $config = {
    schemaVersion => 5, theme => 'dark',
    settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'start', title => 'Start', widgets => [$widget]}],
};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'schema 5 accepts system monitor');
is(FHEMCMS_ValidateBlueprints([{name => 'Monitor', widget => $widget}]), undef, 'blueprint accepts system monitor');
$config->{schemaVersion} = 6;
is(FHEMCMS_ValidateConfig($config, 6), undef, 'schema 6 grid accepts system monitor');
delete($widget->{grid});
$widget->{rect} = {x => 0, y => 0, w => 200, h => 100};
$config->{pages}[0]{layoutMode} = 'freeform';
$config->{pages}[0]{canvas} = {width => 200, height => 200};
is(FHEMCMS_ValidateConfig($config, 6), undef, 'schema 6 freeform accepts system monitor');
delete($widget->{rect});
$widget->{grid} = {col => 1, row => 2, w => 6, h => 8};
delete($config->{pages}[0]{layoutMode});
delete($config->{pages}[0]{canvas});
$config->{schemaVersion} = 5;
$widget->{systemDevice} = '';
is(FHEMCMS_ValidateConfig($config, 5), undef, 'missing source is an explicit choice');
for my $invalid ('../bad', 'bad;set', "bad\nname", [], undef) {
    $widget->{systemDevice} = $invalid;
    like(FHEMCMS_ValidateConfig($config, 5), qr/Systemquelle/, 'invalid system source rejected');
}
$widget->{systemDevice} = 'Local';
$widget->{unexpected} = 1;
ok(defined(FHEMCMS_ValidateConfig($config, 5)), 'unknown widget field rejected');
done_testing();
