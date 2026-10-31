use strict;
use warnings;

use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use Test::More;

our %attr;

require './FHEM/01_FHEMCMS.pm';

my $modHash = {};
FHEMCMS_Initialize($modHash);
is($modHash->{DefFn}, 'FHEMCMS_Define', 'registers the define callback');
is($modHash->{GetFn}, 'FHEMCMS_Get', 'registers the get callback');

my $modPath = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($modPath, 'www'));
$attr{global}{modpath} = $modPath;

my $name = 'CMS';
my $hash = {NAME => $name};
is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines a CMS test device');

my $pagePath = File::Spec->catfile(
    $modPath, 'www', 'fhem-cms', 'CMS', 'default', 'index.html');
ok(-f $pagePath, 'creates the default surface entry page');

open(my $page, '<', $pagePath) or die "Cannot open generated page: $!";
my $html = do { local $/; <$page> };
close($page) or die "Cannot close generated page: $!";
like($html, qr/<cms-device-card device="CMS"/, 'bootstraps the requested device component');
like($html, qr{\.\./\.\./css/fhem-cms\.css}, 'loads shared CSS from the common asset tree');
like($html, qr{\.\./\.\./js/fhem-cms\.js}, 'loads shared JavaScript from the common asset tree');
like($html, qr{type="module"}, 'loads the frontend as an ES module');
ok(-f File::Spec->catfile(
    'www', 'fhem-cms', 'components', 'cms-device-card.js'),
    'provides the shared device-card component');

is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'redefining a device accepts its generated page');
is(FHEMCMS_Get($hash, $name, 'url'),
    '/fhem/fhem-cms/CMS/default/index.html',
    'returns the test page URL');
is(FHEMCMS_Undef($hash), undef, 'allows deleting the device definition');
ok(-f $pagePath, 'keeps the device files when the definition is deleted');

my $lowercaseName = 'cmsLowercase';
my $lowercaseHash = {NAME => $lowercaseName};
is(FHEMCMS_Define($lowercaseHash, "$lowercaseName fhemcms"), undef,
    'accepts a lowercase module type');
ok(-f File::Spec->catfile(
    $modPath, 'www', 'fhem-cms', $lowercaseName, 'default', 'index.html'),
    'creates the start page for a lowercase module type');

my $invalid = {NAME => '../escape'};
like(FHEMCMS_Define($invalid, '../escape FHEMCMS'), qr/Device-Name/,
    'rejects path syntax in device names');

my $collisionName = 'cmsCollision';
my $collisionPath = File::Spec->catfile(
    $modPath, 'www', 'fhem-cms', $collisionName, 'default', 'index.html');
make_path(File::Spec->catdir($modPath, 'www', 'fhem-cms', $collisionName, 'default'));
open(my $custom, '>', $collisionPath) or die "Cannot create collision fixture: $!";
print {$custom} 'user-owned file';
close($custom) or die "Cannot close collision fixture: $!";
my $collision = {NAME => $collisionName};
like(FHEMCMS_Define($collision, "$collisionName FHEMCMS"), qr/existiert bereits/,
    'does not overwrite a file without the module ownership marker');
open(my $preserved, '<', $collisionPath) or die "Cannot read collision fixture: $!";
is(do { local $/; <$preserved> }, 'user-owned file', 'preserves the existing file');
close($preserved) or die "Cannot close collision fixture: $!";

done_testing();
