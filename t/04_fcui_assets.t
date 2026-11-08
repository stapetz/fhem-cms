use strict;
use warnings;

use File::Copy qw(copy);
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use Test::More;

require './FHEM/01_FHEMCMS.pm';

my @assets = (
    'www/fhem-cms/js/fcui-runtime.js',
    'www/fhem-cms/css/fcui-gridstack.css',
    'www/fhem-cms/FCUI-LICENSES.txt',
    'www/fhem-cms/examples/fcui-check.html',
    'www/fhem-cms/examples/migration-preview.html',
    'www/fhem-cms/js/fcui-migration-preview.js',
    'www/fhem-cms/js/fcui-schema5-layout.js',
    'www/fhem-cms/js/fcui-schema5-live.js',
    'www/fhem-cms/js/fcui-schema5-view.js',
    'www/fhem-cms/js/fcui-schema5-draft.js',
    'www/fhem-cms/js/fcui-schema5-grid-edit.js',
    'www/fhem-cms/js/fcui-schema5-backup-panel.js',
    'www/fhem-cms/js/fcui-schema5-move-panel.js',
    'www/fhem-cms/js/fcui-schema5-page-panel.js',
    'www/fhem-cms/js/fcui-schema5-editor.js',
    'www/fhem-cms/js/fcui-schema5-widget-session.js',
    'www/fhem-cms/js/fcui-schema5-widget-panel.js',
    'www/fhem-cms/js/fcui-schema5-navigation.js',
    'www/fhem-cms/js/fcui-schema5-transport.js',
    'www/fhem-cms/js/fcui-migration-transport.js',
    'www/fhem-cms/js/fcui-migration-controller.js',
    'www/fhem-cms/js/widget-services.js',
);
for my $asset (@assets) {
    ok(-s $asset, "$asset exists and is not empty");
}

open(my $list, '-|', 'python3', '-B', '-c',
    'from scripts.generate_controls import deployable_files; print("\n".join(map(str, deployable_files())))')
    or die "Cannot list update assets: $!";
my %deployable = map { chomp; $_ => 1 } <$list>;
close($list) or die 'Cannot enumerate update assets';
ok($deployable{$_}, "$_ is included by the controls generator") for @assets;

my $root = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($root, 'js'), File::Spec->catdir($root, 'css'));
my $script = File::Spec->catfile($root, 'js', 'fcui-runtime.js');
my $style = File::Spec->catfile($root, 'css', 'fcui-gridstack.css');
copy($assets[0], $script) or die "Cannot copy script: $!";
copy($assets[1], $style) or die "Cannot copy stylesheet: $!";
my ($initial, @modules) = FHEMCMS_AssetInfo($root);
ok(grep($_ eq 'js/fcui-runtime.js', @modules), 'runtime participates in the import map');
open(my $js, '>>', $script) or die "Cannot change test script: $!";
print {$js} "\n" or die "Cannot write test script: $!";
close($js) or die "Cannot close test script: $!";
my ($changed_js) = FHEMCMS_AssetInfo($root);
isnt($changed_js, $initial, 'runtime changes invalidate the asset token');
open(my $css, '>>', $style) or die "Cannot change test stylesheet: $!";
print {$css} "\n" or die "Cannot write test stylesheet: $!";
close($css) or die "Cannot close test stylesheet: $!";
my ($changed_css) = FHEMCMS_AssetInfo($root);
isnt($changed_css, $changed_js, 'stylesheet changes invalidate the asset token');

done_testing();
