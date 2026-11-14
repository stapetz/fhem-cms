use strict;
use warnings;
use Test::More;
use JSON::PP ();
require './FHEM/01_FHEMCMS.pm';

my $json = JSON::PP->new->canonical;
my $widget = {id => 'car', type => 'fhem-volvoconnect', device => 'Car',
    showGallery => JSON::PP::true, grid => {col => 1, row => 2, w => 12, h => 18}};
my $config = {schemaVersion => 5, theme => 'liquid-glass',
    settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'auto', title => 'Auto', widgets => [$widget]}]};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'accepts VolvoConnect schema 5');
is(FHEMCMS_ValidateBlueprints([{name => 'Car', widget => $widget}]), undef, 'accepts VolvoConnect blueprint');
for my $case (
    ['unsafe device', sub { $_[0]{device} = 'Car;set'; }],
    ['missing device', sub { delete $_[0]{device}; }],
    ['invalid gallery', sub { $_[0]{showGallery} = 'yes'; }],
    ['numeric gallery', sub { $_[0]{showGallery} = 1; }],
    ['manual mapping', sub { $_[0]{readings} = {}; }],
) {
    my ($label, $change) = @{$case};
    my $copy = $json->decode($json->encode($config));
    $change->($copy->{pages}[0]{widgets}[0]);
    ok(defined(FHEMCMS_ValidateConfig($copy, 5)), "rejects $label");
}
delete $widget->{showGallery};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'gallery defaults on when flag omitted');
$widget->{showGallery} = JSON::PP::false;
is(FHEMCMS_ValidateConfig($config, 5), undef, 'gallery may be disabled');
done_testing();
