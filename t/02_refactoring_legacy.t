use strict;
use warnings;

use Digest::MD5 qw(md5_hex);
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use MIME::Base64 qw(encode_base64);
use Test::More;

our (%attr, $FW_ME);

sub CommandAttr {
    my ($client, $definition) = @_;
    my ($name, $attribute, $value) = split(/\s+/, $definition, 3);
    $attr{$name}{$attribute} = $value;
    return undef;
}

sub Log3 { return; }

require './FHEM/01_FHEMCMS.pm';

my $modPath = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($modPath, 'www'));
$attr{global}{modpath} = $modPath;
my $name = 'LegacyTest';
my $hash = {NAME => $name};
my $json = JSON::PP->new->utf8->canonical;
my $grid = sub { return {col => $_[0], row => $_[1], w => $_[2], h => $_[3]}; };
my $png = "\x89PNG\r\n\x1a\n" . ("\0" x 32);
my $image = md5_hex($png);
my $live = {
    schemaVersion => 4,
    theme => 'light',
    settings => {layoutMode => 'free', gridColumns => 12},
    navigation => {orientation => 'vertical', grid => $grid->(2, 1, 3, 5),
        items => [{page => 'start', label => 'Home', width => 120, height => 40}]},
    pages => [
        {id => 'start', title => 'Start', widgets => [
            {id => 'text', type => 'text', html => qq{<p><strong>{{Temp:temperature|round(1)}}</strong><img src="media/$image.png"></p>},
                grid => $grid->(6, 1, 7, 3)},
            {id => 'html', type => 'fhem-html', devices => ['Temp'],
                html => '<div>{{Temp:temperature|round(1)}} <span device="Temp" reading="temperature" filter="round(1)"></span></div>',
                grid => $grid->(45, 1, 4, 3)},
            {id => 'thermostat', type => 'thermostat', device => 'Temp',
                readings => {actual => 'temperature', target => 'desiredTemperature'}, grid => $grid->(1, 5, 5, 4)},
            {id => 'value', type => 'fhem-value', device => 'Temp', reading => 'temperature',
                grid => $grid->(7, 5, 5, 2)},
            {id => 'clock', type => 'fhem-clock', style => 'analog', showSeconds => JSON::PP::true,
                showDate => JSON::PP::false, showWeekday => JSON::PP::false, grid => $grid->(13, 5, 5, 4)},
            {id => 'icon', type => 'fhem-icon', device => 'Lamp', reading => 'state',
                states => [{value => 'on', icon => 'light_on', color => '#ff0000'}], grid => $grid->(19, 5, 5, 2)},
        ]},
        {id => 'other', title => 'Other', widgets => [
            {id => 'table', type => 'fhem-table', rows => [{device => 'Temp', reading => 'temperature'}],
                grid => $grid->(2, 1, 7, 3)},
            {id => 'slider', type => 'fhem-slider', device => 'Lamp', reading => 'pct', command => 'pct',
                grid => $grid->(10, 1, 5, 3)},
            {id => 'switch', type => 'fhem-switch', device => 'Lamp', reading => 'state', on => 'on', off => 'off',
                grid => $grid->(16, 1, 5, 3)},
            {id => 'button', type => 'fhem-button', device => 'Lamp', command => 'toggle',
                grid => $grid->(22, 1, 5, 3)},
            {id => 'chart', type => 'fhem-chart', device => 'Temp', reading => 'temperature',
                grid => $grid->(28, 1, 5, 3)},
            {id => 'solar', type => 'fhem-solarflow', readings => {pv => {device => 'PV', reading => 'power'}},
                grid => $grid->(34, 1, 5, 3)},
        ]},
    ],
};

sub payload { return encode_base64($json->encode($_[0]), ''); }
sub read_config { return $json->decode(FHEMCMS_Get($hash, $name, $_[0])); }
sub clone_config { return $json->decode($json->encode($_[0])); }

is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated test device');
is(FHEMCMS_Set($hash, $name, 'media', encode_base64($png, '')), "media/$image.png", 'stores referenced test media');
is(FHEMCMS_ValidateConfig($live), undef, 'accepts representative legacy configuration');
is(FHEMCMS_Set($hash, $name, 'config', payload($live)), undef, 'stores legacy live configuration');
is_deeply(read_config('config'), $live, 'live roundtrip preserves widgets, placeholders, media and 48-column coordinates');
is_deeply(read_config('config'), $live, 'repeated reads do not migrate or change schema 4');

my $draft = clone_config($live);
$draft->{pages}[0]{title} = 'Draft';
$draft->{pages}[0]{widgets}[0]{grid} = $grid->(3, 7, 5, 3);
is(FHEMCMS_Set($hash, $name, 'draft', payload($draft)), undef, 'stores independent legacy draft');
is_deeply(read_config('draft'), $draft, 'draft preserves edited 48-column position');
is_deeply(read_config('config'), $live, 'saving draft leaves live untouched');

my $bad = clone_config($draft);
$bad->{unexpected} = 1;
like(FHEMCMS_Set($hash, $name, 'draft', payload($bad)), qr/Unbekanntes Feld/, 'rejects unknown fields');
$bad = clone_config($draft);
$bad->{schemaVersion} = 99;
like(FHEMCMS_Set($hash, $name, 'draft', payload($bad)), qr/schemaVersion/, 'rejects unsupported schema');
is_deeply(read_config('draft'), $draft, 'rejected writes leave draft unchanged');
is_deeply(read_config('config'), $live, 'rejected writes leave live unchanged');

is(FHEMCMS_Set($hash, $name, 'publish'), undef, 'publishes representative draft');
is_deeply(read_config('config'), $draft, 'published data remains unchanged');
my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
my @backups = FHEMCMS_ListBackups($dir);
my @live_backups = grep {
    my ($text, $error) = FHEMCMS_ReadFile(File::Spec->catfile($dir, $_));
    !$error && $json->encode($json->decode($text)) eq $json->encode($live);
} @backups;
is(scalar @live_backups, 1, 'publish backed up the prior live configuration');
is(FHEMCMS_Set($hash, $name, 'draft', payload($draft)), undef, 'creates a draft before restore');
is(FHEMCMS_Set($hash, $name, 'restore', $live_backups[0]), undef, 'restores previous live backup');
is_deeply(read_config('config'), $live, 'restore preserves all original 48-column values and content');
is_deeply(read_config('draft'), $draft, 'restore leaves independent draft unchanged');
my $media_file = File::Spec->catfile($modPath, 'www', 'fhem-cms', $name, 'media', "$image.png");
open(my $media_in, '<:raw', $media_file) or die "Cannot open test media: $!";
my $media_contents = do { local $/; <$media_in> };
close($media_in) or die "Cannot close test media: $!";
is($media_contents, $png, 'publish and restore leave referenced media intact');
like(FHEMCMS_Set($hash, $name, 'restore', '../config.json'), qr/Backup-Name/, 'rejects invalid backup path');
is_deeply(read_config('config'), $live, 'failed restore leaves live unchanged');

done_testing();
