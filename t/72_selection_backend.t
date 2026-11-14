use strict;
use warnings;

use Test::More;

require './FHEM/01_FHEMCMS.pm';

my $widget = {
    id => 'q1',
    type => 'fhem-select',
    device => 'Thermostat',
    command => 'mode',
    reading => 'mode',
    mode => 'buttons',
    labels => {eco => 'Sparbetrieb', comfort => 'Komfort'},
    grid => {col => 1, row => 2, w => 4, h => 3},
};

my $schema4 = {
    schemaVersion => 4,
    pages => [{id => 'start', title => 'Start', widgets => [$widget]}],
};
is(FHEMCMS_ValidateConfig($schema4, 4), undef, 'accepts a selection widget in schema 4');

my $schema5 = {
    schemaVersion => 5,
    theme => 'dark',
    settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'start', title => 'Start', widgets => [$widget]}],
};
is(FHEMCMS_ValidateConfig($schema5, 5), undef, 'accepts a selection widget in schema 5');

my $blueprint = [{name => 'Betriebsart', widget => $widget}];
is(FHEMCMS_ValidateBlueprints($blueprint), undef, 'accepts a selection widget blueprint');

for my $case (
    ['unknown rendering mode', {mode => 'script'}],
    ['unsafe option value', {labels => {'eco;set' => 'Sparbetrieb'}}],
    ['control characters in label', {labels => {eco => "bad\x01label"}}],
    ['oversized labels map', {labels => {map { ("value$_" => 'label') } 1 .. 33}}],
) {
    my ($description, $changes) = @{$case};
    my $candidate = {%{$widget}, %{$changes}};
    my $config = {
        %{$schema5},
        pages => [{id => 'start', title => 'Start', widgets => [$candidate]}],
    };
    like(FHEMCMS_ValidateConfig($config, 5), qr/(?:Auswahl|Anzeigename|labels)/i, "rejects $description");
}

done_testing();
