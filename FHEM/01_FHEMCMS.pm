package main;

use strict;
use warnings;
use Cwd qw(abs_path);
use Digest::MD5 qw(md5_hex);
use Fcntl qw(O_CREAT O_EXCL O_WRONLY);
use File::Copy qw(copy);
use File::Path qw(make_path remove_tree);
use File::Spec;
use JSON::PP ();
use MIME::Base64 qw(decode_base64);
use POSIX qw(strftime);

our $FHEMCMS_VERSION = '0.1.0-dev';
our ($readingFnAttributes, $FW_ME);
our (%attr);
our $FHEMCMS_MAX_CONFIG_BYTES = 1048576;
our $FHEMCMS_MAX_BACKUPS = 20;
our $FHEMCMS_MAX_TEXT = 20000;
our $FHEMCMS_REFRESH_INTERVAL = 10;
our %FHEMCMS_LAST_REFRESH;
our %FHEMCMS_PURGED;
our $FHEMCMS_USAGE_BACKUPS = 20;
our $FHEMCMS_MAX_HTML = 50000;
our $FHEMCMS_MAX_MEDIA_BYTES = 3145728;
our $FHEMCMS_MAX_MEDIA_FILES = 200;
my $FHEMCMS_MEDIA_NAME = qr/\A[0-9a-f]{32}\.(?:png|jpg|gif)\z/;

sub FHEMCMS_Initialize {
    my ($modHash) = @_;

    $modHash->{DefFn} = 'FHEMCMS_Define';
    $modHash->{UndefFn} = 'FHEMCMS_Undef';
    $modHash->{GetFn} = 'FHEMCMS_Get';
    $modHash->{SetFn} = 'FHEMCMS_Set';
    $modHash->{FW_summaryFn} = 'FHEMCMS_Summary';
    $modHash->{AttrList} = $readingFnAttributes // '';
}

sub FHEMCMS_Define {
    my ($hash, $def) = @_;
    my @args = split(/\s+/, $def // '');
    my $name = $hash->{NAME} // '';

    return 'Usage: define <name> FHEMCMS'
        if (@args != 2 || $args[0] ne $name || uc($args[1]) ne 'FHEMCMS');
    return 'Der Device-Name darf nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich enthalten'
        if ($name !~ /\A[A-Za-z0-9_.-]{1,128}\z/ || $name eq '.' || $name eq '..');

    delete($FHEMCMS_PURGED{$name});
    my $error = FHEMCMS_CreateStartPage($name);
    return $error if (defined($error));

    # Läuft bei jedem Start: richtet Datenordner und Konfiguration für bestehende Devices nach.
    my ($dataError, $dataDir) = FHEMCMS_CreateDataDir($name);
    return $dataError if (defined($dataError));
    $error = FHEMCMS_EnsureConfig($name, $dataDir);
    return $error if (defined($error));

    if (!defined($main::attr{$name}{room}) || $main::attr{$name}{room} eq '') {
        $error = CommandAttr(undef, "$name room FHEM CMS");
        return $error if (defined($error));
    }

    $hash->{VERSION} = $FHEMCMS_VERSION;
    $hash->{STATE} = 'defined';
    return undef;
}

sub FHEMCMS_Undef {
    return undef;
}

sub FHEMCMS_ValidName {
    my ($name) = @_;
    return defined($name) && $name =~ /\A[A-Za-z0-9_.-]{1,128}\z/ && $name !~ /\A\.{1,2}\z/;
}

sub FHEMCMS_Get {
    my ($hash, $name, $cmd) = @_;
    $cmd //= '';

    return 'Die Daten dieses Devices wurden geloescht; bitte das Device loeschen oder FHEM neu starten'
        if (defined($name) && $FHEMCMS_PURGED{$name});

    if ($cmd eq 'url') {
        return 'Ungueltiges Device'
            if (!defined($name) || $name ne ($hash->{NAME} // '') || !FHEMCMS_ValidName($name));
        my $basePath = $main::FW_ME || '/fhem';
        $basePath =~ s{/$}{};
        return $basePath . '/fhem-cms/' . $name . '/index.html';
    }

    if ($cmd eq 'config' || $cmd eq 'backups' || $cmd eq 'draft' || $cmd eq 'status') {
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my ($error, $dataDir) = FHEMCMS_CreateDataDir($name);
        return $error if (defined($error));

        if ($cmd eq 'backups') {
            return JSON::PP->new->utf8->canonical->encode([FHEMCMS_ListBackups($dataDir)]);
        }
        my $draftFile = File::Spec->catfile($dataDir, 'draft.json');
        if ($cmd eq 'status') {
            return JSON::PP->new->utf8->canonical->encode({draft => (-f $draftFile ? JSON::PP::true : JSON::PP::false)});
        }
        # Ohne Entwurf startet die Bearbeitung mit einer Kopie des Live-Stands.
        my $source = ($cmd eq 'draft' && -f $draftFile) ? $draftFile : File::Spec->catfile($dataDir, 'config.json');
        my ($text, $readError) = FHEMCMS_ReadFile($source);
        return $readError if (defined($readError));
        my ($config, $parseError) = FHEMCMS_ParseConfig($text);
        return "Konfiguration ist ungueltig: $parseError" if (defined($parseError));
        return JSON::PP->new->utf8->canonical->encode($config);
    }

    if ($cmd eq 'media') {
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my ($error, $mediaDir) = FHEMCMS_MediaDir($name);
        return $error if (defined($error));
        return JSON::PP->new->utf8->encode([FHEMCMS_ListMedia($mediaDir)]);
    }

    return 'Unknown argument ' . $cmd . ', choose one of url:noArg config:noArg draft:noArg status:noArg backups:noArg media:noArg';
}

sub FHEMCMS_Set {
    my ($hash, $name, $cmd, @args) = @_;
    $cmd //= '';

    if ($cmd eq 'purge') {
        return 'purge erwartet den Device-Namen als Bestaetigung' if (@args != 1);
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        return 'Zur Bestaetigung muss der Device-Name angegeben werden' if ($args[0] ne $name);
        my $error = FHEMCMS_Purge($name);
        return $error if (defined($error));
        $FHEMCMS_PURGED{$name} = 1;
        $hash->{STATE} = 'purged' if (ref($hash) eq 'HASH');
        Log3($name, 2, "FHEMCMS ($name): Daten und Startseite wurden geloescht");
        return undef;
    }

    return 'Die Daten dieses Devices wurden geloescht; bitte das Device loeschen oder FHEM neu starten'
        if (defined($name) && $FHEMCMS_PURGED{$name});

    if ($cmd eq 'media') {
        return 'media erwartet genau einen Base64-Parameter' if (@args != 1);
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my ($error, $file) = FHEMCMS_StoreMedia($name, $args[0]);
        return $error if (defined($error));
        return "media/$file";
    }

    if ($cmd eq 'publish' || $cmd eq 'discard') {
        return "$cmd erwartet keine Parameter" if (@args);
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my ($error, $dataDir) = FHEMCMS_CreateDataDir($name);
        return $error if (defined($error));
        my $draftFile = File::Spec->catfile($dataDir, 'draft.json');
        if ($cmd eq 'discard') {
            return undef if (!-e $draftFile);
            return "Entwurf konnte nicht geloescht werden: $!" if (!unlink($draftFile));
            return undef;
        }
        return 'Es gibt keinen Entwurf zum Veroeffentlichen' if (!-f $draftFile);
        my ($text, $readError) = FHEMCMS_ReadFile($draftFile);
        return $readError if (defined($readError));
        my ($config, $parseError) = FHEMCMS_ParseConfig($text);
        return "Entwurf ist ungueltig: $parseError" if (defined($parseError));
        my $writeError = FHEMCMS_WriteConfig($name, $dataDir, $config);
        return $writeError if (defined($writeError));
        # Der Live-Stand ist gesichert und geschrieben; ein verbleibender Entwurf waere nur ein Duplikat.
        unlink($draftFile);
        Log3($name, 3, "FHEMCMS ($name): Entwurf wurde veroeffentlicht");
        return undef;
    }

    if ($cmd eq 'config' || $cmd eq 'restore' || $cmd eq 'draft') {
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        return "$cmd erwartet genau einen Parameter" if (@args != 1);
        my ($error, $dataDir) = FHEMCMS_CreateDataDir($name);
        return $error if (defined($error));

        if ($cmd eq 'restore') {
            return FHEMCMS_RestoreBackup($name, $dataDir, $args[0]);
        }

        # Base64, damit Leerzeichen und Semikolons den FHEM-Befehl nicht veraendern.
        return 'Konfiguration ist zu gross' if (length($args[0]) > 2 * $FHEMCMS_MAX_CONFIG_BYTES);
        return 'Konfiguration ist nicht Base64-kodiert' if ($args[0] !~ /\A[A-Za-z0-9+\/]+={0,2}\z/);
        my ($config, $parseError) = FHEMCMS_ParseConfig(decode_base64($args[0]));
        return $parseError if (defined($parseError));
        return FHEMCMS_WriteConfig($name, $dataDir, $config, $cmd eq 'draft' ? 'draft.json' : 'config.json');
    }

    if ($cmd eq 'rebuild') {
        return 'rebuild erwartet keine Parameter' if (@args);
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my $error = FHEMCMS_CreateStartPage($name);
        return $error if (defined($error));
        $FHEMCMS_LAST_REFRESH{$name} = time();
        return undef;
    }

    return 'Unknown argument ' . $cmd . ', choose one of ' . FHEMCMS_SetUsage($name);
}

# Die neuesten Backups erscheinen als Auswahlliste bei "restore".
sub FHEMCMS_SetUsage {
    my ($name) = @_;
    my @backups;
    if (FHEMCMS_ValidName($name) && !$FHEMCMS_PURGED{$name}) {
        my ($error, $dataDir) = FHEMCMS_CreateDataDir($name);
        @backups = FHEMCMS_ListBackups($dataDir) if (!defined($error));
        splice(@backups, $FHEMCMS_USAGE_BACKUPS) if (@backups > $FHEMCMS_USAGE_BACKUPS);
    }
    my $restore = @backups ? 'restore:' . join(',', @backups) : 'restore';
    return "config draft publish:noArg discard:noArg $restore rebuild:noArg media purge";
}

sub FHEMCMS_Summary {
    my ($webName, $name) = @_;
    return '' if (!defined($name) || $name !~ /\A[A-Za-z0-9_.-]{1,128}\z/);
    return 'Daten geloescht - Device kann geloescht werden' if ($FHEMCMS_PURGED{$name});

    # Nach einem Update zeigt der Startlink sofort auf eine Seite mit neuem Cache-Token.
    my $now = time();
    if (!defined($FHEMCMS_LAST_REFRESH{$name}) || $now - $FHEMCMS_LAST_REFRESH{$name} >= $FHEMCMS_REFRESH_INTERVAL) {
        $FHEMCMS_LAST_REFRESH{$name} = $now;
        my $error = FHEMCMS_CreateStartPage($name);
        Log3($name, 2, "FHEMCMS ($name): Startseite konnte nicht aktualisiert werden: $error")
            if (defined($error));
    }

    my $basePath = $main::FW_ME || '/fhem';
    $basePath =~ s{/$}{};
    my $entry = $basePath . '/fhem-cms/' . $name . '/index.html';
    return '<a href="' . $entry . '?mode=edit" target="_blank" rel="noopener">CMS starten</a> <a href="' . $entry . '" target="_blank" rel="noopener">Zeige Homepage</a>';
}

# Entfernt Datenordner und Startseite eines Devices. Symlinks und fremde Dateien werden nicht angetastet.
sub FHEMCMS_Purge {
    my ($name) = @_;
    my $modPath = $main::attr{global}{modpath};
    return 'FHEM global modpath ist nicht gesetzt' if (!defined($modPath) || $modPath eq '');
    my $root = abs_path($modPath);
    return 'FHEM global modpath verweist nicht auf ein Verzeichnis' if (!defined($root) || !-d $root);

    my $dataRoot = abs_path(File::Spec->catdir($root, 'fhem-cms-data'));
    my $cmsRoot = abs_path(File::Spec->catdir($root, 'www', 'fhem-cms'));
    my $dataDir = File::Spec->catdir($root, 'fhem-cms-data', $name);
    my $pageDir = File::Spec->catdir($root, 'www', 'fhem-cms', $name);
    my $marker = '<!-- generated by 01_FHEMCMS.pm; do not edit -->';

    for my $entry ([$dataDir, $dataRoot], [$pageDir, $cmsRoot]) {
        my ($dir, $parent) = @{$entry};
        next if (!-e $dir && !-l $dir);
        return "Verzeichnis '$dir' ist ein Symlink und wird nicht geloescht" if (-l $dir);
        my $real = abs_path($dir);
        return "Verzeichnis '$dir' liegt ausserhalb des erwarteten Bereichs"
            if (!defined($parent) || !defined($real) || !FHEMCMS_IsChildPath($real, $parent));
    }

    # Die Startseite nur loeschen, wenn sie vom Modul stammt und sonst nichts im Ordner liegt.
    if (-d $pageDir) {
        opendir(my $dh, $pageDir) or return "Verzeichnis '$pageDir' konnte nicht gelesen werden: $!";
        my @entries = grep { $_ ne '.' && $_ ne '..' } readdir($dh);
        closedir($dh);
        my $mediaDir = File::Spec->catdir($pageDir, 'media');
        my @foreign = grep { $_ ne 'index.html' && $_ !~ /\Aindex\.html\..*\.tmp\z/ && $_ ne 'media' } @entries;
        if (grep { $_ eq 'media' } @entries) {
            return "Verzeichnis '$mediaDir' ist kein reines Medienverzeichnis" if (-l $mediaDir || !-d $mediaDir);
            opendir(my $mh, $mediaDir) or return "Verzeichnis '$mediaDir' konnte nicht gelesen werden: $!";
            my @mediaForeign = grep { $_ ne '.' && $_ ne '..' && $_ !~ $FHEMCMS_MEDIA_NAME
                && $_ !~ /\A\.upload-.*\.tmp\z/ } readdir($mh);
            closedir($mh);
            return "Medienverzeichnis enthaelt fremde Dateien (" . join(', ', sort @mediaForeign) . ')'
                if (@mediaForeign);
        }
        return "Verzeichnis '$pageDir' enthaelt fremde Dateien (" . join(', ', sort @foreign) . ')' if (@foreign);
        if (grep { $_ eq 'index.html' } @entries) {
            my ($text, $readError) = FHEMCMS_ReadFile(File::Spec->catfile($pageDir, 'index.html'));
            return $readError if (defined($readError));
            return 'Die Startseite stammt nicht von diesem Modul und wird nicht geloescht'
                if (index($text, $marker) < 0);
        }
    }

    for my $dir ($dataDir, $pageDir) {
        next if (!-d $dir);
        my $errors;
        remove_tree($dir, {error => \$errors});
        return FHEMCMS_PathError('Verzeichnis konnte nicht geloescht werden', $dir, $errors)
            if (ref($errors) eq 'ARRAY' && @{$errors});
    }
    return undef;
}

sub FHEMCMS_CreateStartPage {
    my ($name) = @_;
    my $modPath = $main::attr{global}{modpath};
    return 'FHEM global modpath ist nicht gesetzt'
        if (!defined($modPath) || $modPath eq '');

    my $root = abs_path($modPath);
    return 'FHEM global modpath verweist nicht auf ein Verzeichnis'
        if (!defined($root) || !-d $root);

    my $wwwPath = File::Spec->catdir($root, 'www');
    my $wwwRoot = abs_path($wwwPath);
    return 'Das FHEM-Verzeichnis www wurde nicht gefunden'
        if (!defined($wwwRoot) || !-d $wwwRoot);

    my $cmsPath = File::Spec->catdir($wwwRoot, 'fhem-cms');
    if (!-d $cmsPath) {
        my $errors;
        make_path($cmsPath, {error => \$errors});
        return FHEMCMS_PathError('CMS-Verzeichnis konnte nicht angelegt werden', $cmsPath, $errors)
            if (ref($errors) eq 'ARRAY' && @{$errors});
    }

    my $cmsRoot = abs_path($cmsPath);
    return 'Das CMS-Verzeichnis liegt nicht innerhalb des FHEM-www-Verzeichnisses'
        if (!defined($cmsRoot) || !FHEMCMS_IsChildPath($cmsRoot, $wwwRoot));

    my $devicePath = File::Spec->catdir($cmsRoot, $name);
    if (!-d $devicePath) {
        my $errors;
        make_path($devicePath, {error => \$errors});
        return FHEMCMS_PathError('Device-Verzeichnis konnte nicht angelegt werden', $devicePath, $errors)
            if (ref($errors) eq 'ARRAY' && @{$errors});
    }
    my $realPath = abs_path($devicePath);
    return 'Das CMS-Device-Verzeichnis liegt ausserhalb des CMS-Verzeichnisses'
        if (!defined($realPath) || !FHEMCMS_IsChildPath($realPath, $cmsRoot));

    my $filePath = File::Spec->catfile($devicePath, 'index.html');
    my $marker = '<!-- generated by 01_FHEMCMS.pm; do not edit -->';
    my $managed = 0;
    if (-e $filePath) {
        if (open(my $existing, '<', $filePath)) {
            my $firstLine = <$existing>;
            close($existing);
            $managed = defined($firstLine) && index($firstLine, $marker) >= 0;
        }
        return 'Die CMS-Startseite existiert bereits und wird nicht überschrieben'
            if (!$managed);
    }

    my ($token, @modules) = FHEMCMS_AssetInfo($cmsRoot);
    my $importMap = JSON::PP->new->canonical->pretty->encode({
        imports => {map { ("../$_" => "../$_?v=$token") } @modules},
    });
    $importMap =~ s/\n\z//;

    my $htmlName = FHEMCMS_HtmlEscape($name);
    my $content = <<"HTML";
$marker
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="fhem-cms-device" content="$htmlName">
  <title>fhem-cms - $htmlName</title>
  <link rel="stylesheet" href="../css/fhem-cms.css?v=$token">
  <script type="importmap">
$importMap
  </script>
  <script type="module" src="../js/fhem-cms.js?v=$token"></script>
</head>
<body>
  <main class="cms-shell">
    <p class="cms-status" role="status">Frontend wird geladen ...</p>
  </main>
</body>
</html>
HTML

    if ($managed) {
        my $current;
        if (open(my $in, '<', $filePath)) {
            local $/;
            $current = <$in>;
            close($in);
        }
        return undef if (defined($current) && $current eq $content);
    }

    my $writePath = $managed ? "$filePath.tmp" : $filePath;
    my $output;
    if (!sysopen($output, $writePath, O_WRONLY | O_CREAT | O_EXCL, 0644)) {
        return "CMS-Startseite konnte nicht angelegt werden: $!";
    }
    my $written = print {$output} $content;
    my $closeOk = close($output);
    if (!$written || !$closeOk) {
        my $writeError = "$!";
        unlink($writePath);
        return "CMS-Startseite konnte nicht vollstaendig geschrieben werden: $writeError";
    }
    if ($managed && !rename($writePath, $filePath)) {
        my $renameError = "$!";
        unlink($writePath);
        return "CMS-Startseite konnte nicht aktualisiert werden: $renameError";
    }

    return undef;
}

# Token aus dem Inhalt der Frontend-Dateien, damit Browser nach einem Update neu laden.
sub FHEMCMS_AssetInfo {
    my ($cmsRoot) = @_;
    my $digest = Digest::MD5->new;
    my @modules;
    foreach my $dir ('css', 'js', 'components') {
        my $dirPath = File::Spec->catdir($cmsRoot, $dir);
        next if (!opendir(my $dh, $dirPath));
        my @files = sort grep { /\A[A-Za-z0-9_.-]+\.(?:js|css)\z/ } readdir($dh);
        closedir($dh);
        foreach my $file (@files) {
            my $path = File::Spec->catfile($dirPath, $file);
            next if (!-f $path);
            open(my $in, '<:raw', $path) or next;
            local $/;
            $digest->add("$dir/$file\0", scalar(<$in>) // '');
            close($in);
            push(@modules, "$dir/$file") if ($file =~ /\.js\z/ && $file ne 'fhem-cms.js');
        }
    }
    return (substr($digest->hexdigest, 0, 10), @modules);
}

sub FHEMCMS_CreateDataDir {
    my ($name) = @_;
    my $modPath = $main::attr{global}{modpath};
    return ('FHEM global modpath ist nicht gesetzt')
        if (!defined($modPath) || $modPath eq '');

    my $root = abs_path($modPath);
    return ('FHEM global modpath verweist nicht auf ein Verzeichnis')
        if (!defined($root) || !-d $root);

    my $dataPath = File::Spec->catdir($root, 'fhem-cms-data');
    my $devicePath = File::Spec->catdir($dataPath, $name);
    if (!-d $devicePath) {
        my $errors;
        make_path($devicePath, {mode => 0750, error => \$errors});
        return (FHEMCMS_PathError('Datenverzeichnis konnte nicht angelegt werden', $devicePath, $errors))
            if (ref($errors) eq 'ARRAY' && @{$errors});
    }

    my $dataRoot = abs_path($dataPath);
    my $realPath = abs_path($devicePath);
    return ('Das CMS-Datenverzeichnis liegt ausserhalb des FHEM-Verzeichnisses')
        if (!defined($dataRoot) || !defined($realPath)
            || !FHEMCMS_IsChildPath($dataRoot, $root) || !FHEMCMS_IsChildPath($realPath, $dataRoot));

    return (undef, $realPath);
}

sub FHEMCMS_DefaultConfig {
    return {
        schemaVersion => 2,
        pages => [{id => 'start', title => 'Start', widgets => []}],
    };
}

sub FHEMCMS_EnsureConfig {
    my ($name, $dataDir) = @_;
    my $file = File::Spec->catfile($dataDir, 'config.json');
    return undef if (-e $file);
    return FHEMCMS_WriteConfig($name, $dataDir, FHEMCMS_DefaultConfig());
}

# Hebt eine Konfiguration der Schema-Version 1 auf Version 2 (Widgets erhalten eine ID).
sub FHEMCMS_MigrateConfig {
    my ($config) = @_;
    return $config if (ref($config) ne 'HASH' || !defined($config->{schemaVersion})
        || ref($config->{schemaVersion}) || $config->{schemaVersion} ne '1');
    return $config if (ref($config->{pages}) ne 'ARRAY');

    for my $page (@{$config->{pages}}) {
        next if (ref($page) ne 'HASH' || ref($page->{widgets}) ne 'ARRAY');
        my $n = 0;
        for my $widget (@{$page->{widgets}}) {
            $n++;
            $widget->{id} = "w$n" if (ref($widget) eq 'HASH' && !exists($widget->{id}));
        }
    }
    $config->{schemaVersion} = 2;
    return $config;
}

sub FHEMCMS_ValidateConfig {
    my ($config) = @_;
    my $id = qr/\A[A-Za-z0-9_-]{1,64}\z/;
    my $fhemName = qr/\A[A-Za-z0-9_.-]{1,128}\z/;

    my $exact = sub {
        my ($ref, $where, $required, $optional) = @_;
        return "$where muss ein Objekt sein" if (ref($ref) ne 'HASH');
        my %ok = map { $_ => 1 } (@{$required}, @{$optional || []});
        for my $key (sort keys %{$ref}) {
            return "Unbekanntes Feld '$key' in $where" if (!$ok{$key});
        }
        for my $key (@{$required}) {
            return "Pflichtfeld '$key' fehlt in $where" if (!exists($ref->{$key}));
        }
        return undef;
    };
    my $isInt = sub {
        my ($v, $min, $max) = @_;
        return defined($v) && !ref($v) && $v =~ /\A[0-9]{1,6}\z/ && $v >= $min && $v <= $max;
    };
    my $isName = sub {
        my ($v) = @_;
        return defined($v) && !ref($v) && $v =~ $fhemName && $v !~ /\A\.{1,2}\z/;
    };

    my $checkGrid = sub {
        my ($grid) = @_;
        my $gridError = $exact->($grid, 'grid', ['col', 'row', 'w', 'h']);
        return $gridError if ($gridError);
        return 'Ungueltige Rasterwerte'
            if (!$isInt->($grid->{col}, 1, 12) || !$isInt->($grid->{row}, 1, 1000)
                || !$isInt->($grid->{w}, 1, 12) || !$isInt->($grid->{h}, 1, 1000)
                || $grid->{col} + $grid->{w} > 13);
        return undef;
    };

    my $err = $exact->($config, 'Konfiguration', ['schemaVersion', 'pages'], ['navigation']);
    return $err if ($err);
    if (exists($config->{navigation})) {
        $err = $exact->($config->{navigation}, 'navigation', ['orientation', 'grid']);
        return $err if ($err);
        return 'Ungueltige Ausrichtung der Navigation'
            if (ref($config->{navigation}{orientation}) || !defined($config->{navigation}{orientation})
                || $config->{navigation}{orientation} !~ /\A(?:horizontal|vertical)\z/);
        $err = $checkGrid->($config->{navigation}{grid});
        return $err if ($err);
    }
    return 'Nicht unterstuetzte schemaVersion'
        if (!$isInt->($config->{schemaVersion}, 2, 2));
    return 'pages muss eine Liste mit 1 bis 50 Seiten sein'
        if (ref($config->{pages}) ne 'ARRAY' || @{$config->{pages}} < 1 || @{$config->{pages}} > 50);

    my %pageIds;
    for my $page (@{$config->{pages}}) {
        $err = $exact->($page, 'Seite', ['id', 'title', 'widgets']);
        return $err if ($err);
        return 'Ungueltige Seiten-ID'
            if (ref($page->{id}) || !defined($page->{id}) || $page->{id} !~ $id);
        return "Doppelte Seiten-ID '$page->{id}'" if ($pageIds{$page->{id}}++);
        return 'Ungueltiger Seitentitel'
            if (ref($page->{title}) || !defined($page->{title})
                || length($page->{title}) < 1 || length($page->{title}) > 128
                || $page->{title} =~ /[\x00-\x1f\x7f]/);
        return 'widgets muss eine Liste mit hoechstens 200 Eintraegen sein'
            if (ref($page->{widgets}) ne 'ARRAY' || @{$page->{widgets}} > 200);

        my %widgetIds;
        for my $widget (@{$page->{widgets}}) {
            return 'Widget muss ein Objekt sein' if (ref($widget) ne 'HASH');
            return 'Unbekannter Widget-Typ'
                if (ref($widget->{type}) || !defined($widget->{type})
                    || ($widget->{type} ne 'fhem-value' && $widget->{type} ne 'thermostat'
                        && $widget->{type} ne 'text'));

            if ($widget->{type} eq 'text') {
                my $body = exists($widget->{html}) ? 'html' : 'markdown';
                $err = $exact->($widget, 'Widget', ['id', 'type', $body, 'grid'], ['title']);
            } elsif ($widget->{type} eq 'fhem-value') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'reading', 'grid']);
            } else {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'grid', 'readings'], ['title']);
            }
            return $err if ($err);

            return 'Ungueltige Widget-ID'
                if (ref($widget->{id}) || !defined($widget->{id}) || $widget->{id} !~ $id);
            return "Doppelte Widget-ID '$widget->{id}'" if ($widgetIds{$widget->{id}}++);
            return 'Ungueltiger Widget-Titel'
                if ($widget->{type} eq 'text' && exists($widget->{title})
                    && (ref($widget->{title}) || !defined($widget->{title})
                        || length($widget->{title}) > 64 || $widget->{title} =~ /[\x00-\x1f\x7f]/));

            if ($widget->{type} eq 'text' && exists($widget->{html})) {
                my $htmlError = FHEMCMS_ValidateHtml($widget->{html});
                return "Ungueltiger HTML-Text: $htmlError" if (defined($htmlError));
            } elsif ($widget->{type} eq 'text') {
                my $text = $widget->{markdown};
                return 'Ungueltiger Markdown-Text'
                    if (ref($text) || !defined($text) || length($text) > $FHEMCMS_MAX_TEXT
                        || $text =~ /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
            } else {
                return 'Ungueltiger Wert fuer device' if (!$isName->($widget->{device}));
            }

            if ($widget->{type} eq 'text') {
                # keine weiteren Felder
            } elsif ($widget->{type} eq 'fhem-value') {
                return 'Ungueltiger Wert fuer reading' if (!$isName->($widget->{reading}));
            } else {
                return 'Ungueltiger Widget-Titel'
                    if (exists($widget->{title})
                        && (ref($widget->{title}) || !defined($widget->{title})
                            || length($widget->{title}) > 64 || $widget->{title} =~ /[\x00-\x1f\x7f]/));
                $err = $exact->($widget->{readings}, 'readings', ['actual', 'target'],
                    ['valve', 'mode', 'battery']);
                return $err if ($err);
                for my $field (keys %{$widget->{readings}}) {
                    return "Ungueltiger Wert fuer readings.$field"
                        if (!$isName->($widget->{readings}{$field}));
                }
            }

            $err = $checkGrid->($widget->{grid});
            return $err if ($err);
        }
    }
    return undef;
}

# Prueft HTML strikt gegen eine Allowlist. Der Editor serialisiert nur diese Teilmenge;
# alles andere wird abgelehnt statt umgeschrieben.
sub FHEMCMS_ValidateHtml {
    my ($html) = @_;
    return 'kein Text' if (ref($html) || !defined($html));
    return 'zu lang' if (length($html) > $FHEMCMS_MAX_HTML);
    return 'enthaelt Steuerzeichen' if ($html =~ /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);

    my %align = map { $_ => 1 } qw(cms-align-left cms-align-center cms-align-right);
    my %imageClass = map { $_ => 1 } qw(cms-img-left cms-img-right cms-img-center cms-img-full),
        map { 'cms-w-' . ($_ * 5) } 1 .. 20;
    my %tags = (
        p => {class => \%align}, h1 => {class => \%align}, h2 => {class => \%align},
        h3 => {class => \%align}, blockquote => {class => \%align},
        th => {class => \%align}, td => {class => \%align},
        strong => {}, em => {}, u => {}, s => {}, code => {}, ul => {}, ol => {}, li => {},
        table => {}, thead => {}, tbody => {}, tr => {},
        a => {href => 1}, img => {src => 1, alt => 1, class => \%imageClass},
        br => {void => 1}, hr => {void => 1},
    );
    $tags{img}{void} = 1;

    my @stack;
    my $count = 0;
    my $text = $html;
    pos($text) = 0;
    while (pos($text) < length($text)) {
        next if ($text =~ /\G[^<>&]+/gc);
        next if ($text =~ /\G&(?:amp|lt|gt|quot|nbsp|#39);/gc);
        if ($text =~ /\G<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z]+="[^"<>]*")*)\s*>/gc) {
            my ($closing, $tag, $attrs) = ($1, $2, $3);
            return "Tag '$tag' ist nicht erlaubt" if (!$tags{$tag});
            return 'zu viele Elemente' if (++$count > 3000);
            if ($closing) {
                return "Unerwartetes Ende von '$tag'" if ($attrs ne '' || !@stack || $stack[-1] ne $tag);
                pop(@stack);
                next;
            }
            my %seen;
            while ($attrs =~ /\s+([a-z]+)="([^"<>]*)"/g) {
                my ($attr, $value) = ($1, $2);
                return "Attribut '$attr' ist bei '$tag' nicht erlaubt" if (!$tags{$tag}{$attr} || $seen{$attr}++);
                (my $plain = $value) =~ s/&(?:amp|quot|#39|nbsp|lt|gt);/ /g;
                return 'ungueltige Zeichenfolge in Attribut' if ($plain =~ /&/);
                (my $decoded = $value) =~ s/&amp;/&/g;
                if ($attr eq 'href') {
                    return 'ungueltiger Link'
                        if ($decoded !~ m{\A(?:https?://[A-Za-z0-9._~:/?\#\[\]\@!\$&'()*+,;=%-]{1,2000}|mailto:[A-Za-z0-9._%+-]{1,64}\@[A-Za-z0-9.-]{1,255}|\#/[A-Za-z0-9_-]{1,64})\z});
                } elsif ($attr eq 'src') {
                    return 'ungueltige Bildquelle'
                        if ($decoded !~ m{\Amedia/[0-9a-f]{32}\.(?:png|jpg|gif)\z});
                } elsif ($attr eq 'alt') {
                    return 'ungueltiger Alternativtext' if (length($decoded) > 200);
                } else {
                    my @classes = split(/ /, $value);
                    return 'ungueltige Klasse' if (!@classes || grep { !$tags{$tag}{class}{$_} } @classes);
                }
            }
            return "'$tag' braucht ein Pflichtattribut"
                if (($tag eq 'a' && $attrs !~ /\shref="/) || ($tag eq 'img' && $attrs !~ /\ssrc="/));
            if (!$tags{$tag}{void}) {
                push(@stack, $tag);
                return 'zu tief verschachtelt' if (@stack > 30);
            }
            next;
        }
        return 'ungueltige Zeichenfolge an Position ' . pos($text);
    }
    return 'nicht geschlossene Elemente' if (@stack);
    return undef;
}

sub FHEMCMS_MediaDir {
    my ($name) = @_;
    my $modPath = $main::attr{global}{modpath};
    return ('FHEM global modpath ist nicht gesetzt') if (!defined($modPath) || $modPath eq '');
    my $root = abs_path($modPath);
    return ('FHEM global modpath verweist nicht auf ein Verzeichnis') if (!defined($root) || !-d $root);
    my $cmsRoot = abs_path(File::Spec->catdir($root, 'www', 'fhem-cms'));
    my $pageDir = File::Spec->catdir($root, 'www', 'fhem-cms', $name);
    return ('Die Startseite des Devices existiert nicht') if (!-d $pageDir || -l $pageDir);
    my $realPage = abs_path($pageDir);
    return ('Das Device-Verzeichnis liegt ausserhalb von www/fhem-cms')
        if (!defined($cmsRoot) || !defined($realPage) || !FHEMCMS_IsChildPath($realPage, $cmsRoot));
    my $mediaDir = File::Spec->catdir($realPage, 'media');
    return ('Das Medienverzeichnis ist ein Symlink') if (-l $mediaDir);
    return (undef, $mediaDir);
}

sub FHEMCMS_ListMedia {
    my ($mediaDir) = @_;
    opendir(my $dh, $mediaDir) or return ();
    my @files = sort grep { $_ =~ $FHEMCMS_MEDIA_NAME && !-l File::Spec->catfile($mediaDir, $_) } readdir($dh);
    closedir($dh);
    return @files;
}

# Speichert ein hochgeladenes Bild (Base64). Der Typ wird am Dateikopf erkannt, nicht am Namen.
sub FHEMCMS_StoreMedia {
    my ($name, $base64) = @_;
    return ('Bild ist zu gross') if (length($base64) > int($FHEMCMS_MAX_MEDIA_BYTES * 4 / 3) + 8);
    return ('Ungueltige Base64-Daten') if ($base64 !~ /\A[A-Za-z0-9+\/]+={0,2}\z/ || length($base64) % 4);
    my $data = decode_base64($base64);
    return ('Bild ist leer oder zu gross') if (length($data) < 16 || length($data) > $FHEMCMS_MAX_MEDIA_BYTES);

    my $ext;
    if (substr($data, 0, 8) eq "\x89PNG\r\n\x1a\n") {
        $ext = 'png';
    } elsif (substr($data, 0, 3) eq "\xff\xd8\xff") {
        $ext = 'jpg';
    } elsif (substr($data, 0, 6) eq 'GIF87a' || substr($data, 0, 6) eq 'GIF89a') {
        $ext = 'gif';
    }
    return ('Nur PNG-, JPEG- und GIF-Bilder sind erlaubt') if (!defined($ext));

    my ($error, $mediaDir) = FHEMCMS_MediaDir($name);
    return ($error) if (defined($error));
    if (!-d $mediaDir) {
        my $errors;
        make_path($mediaDir, {error => \$errors});
        return (FHEMCMS_PathError('Medienverzeichnis konnte nicht angelegt werden', $mediaDir, $errors))
            if (ref($errors) eq 'ARRAY' && @{$errors});
    }

    my $file = md5_hex($data) . ".$ext";
    my $target = File::Spec->catfile($mediaDir, $file);
    return (undef, $file) if (-f $target && !-l $target);
    return ('Es sind hoechstens ' . $FHEMCMS_MAX_MEDIA_FILES . ' Bilder pro Device erlaubt')
        if (scalar(FHEMCMS_ListMedia($mediaDir)) >= $FHEMCMS_MAX_MEDIA_FILES);

    my $tmp = File::Spec->catfile($mediaDir, ".upload-$$-" . time() . '.tmp');
    sysopen(my $out, $tmp, O_CREAT | O_EXCL | O_WRONLY, 0644)
        or return ("Bild konnte nicht gespeichert werden: $!");
    binmode($out);
    my $ok = print {$out} $data;
    $ok = close($out) && $ok;
    if (!$ok || !rename($tmp, $target)) {
        my $reason = $!;
        unlink($tmp);
        return ("Bild konnte nicht gespeichert werden: $reason");
    }
    return (undef, $file);
}

sub FHEMCMS_ParseConfig {
    my ($text) = @_;
    return (undef, 'Konfiguration ist zu gross') if (length($text) > $FHEMCMS_MAX_CONFIG_BYTES);
    my $config = eval { JSON::PP->new->utf8->decode($text) };
    return (undef, 'Konfiguration ist kein gueltiges JSON') if (!defined($config));
    $config = FHEMCMS_MigrateConfig($config);
    my $error = FHEMCMS_ValidateConfig($config);
    return (undef, $error) if (defined($error));
    return ($config, undef);
}

sub FHEMCMS_ReadFile {
    my ($file) = @_;
    return (undef, 'Datei nicht gefunden') if (!-f $file);
    return (undef, 'Konfiguration ist zu gross') if (-s $file > $FHEMCMS_MAX_CONFIG_BYTES);
    open(my $in, '<:raw', $file) or return (undef, "Datei konnte nicht gelesen werden: $!");
    local $/;
    my $text = <$in>;
    close($in);
    return ($text, undef);
}

sub FHEMCMS_ReadConfig {
    my ($name, $dataDir) = @_;
    my ($text, $error) = FHEMCMS_ReadFile(File::Spec->catfile($dataDir, 'config.json'));
    return (undef, $error) if (defined($error));
    return FHEMCMS_ParseConfig($text);
}

sub FHEMCMS_WriteConfig {
    my ($name, $dataDir, $config, $target) = @_;
    $target //= 'config.json';
    my $isDraft = $target eq 'draft.json';
    my $error = FHEMCMS_ValidateConfig($config);
    return $error if (defined($error));

    my $text = JSON::PP->new->utf8->canonical->pretty->encode($config);
    return 'Konfiguration ist zu gross' if (length($text) > $FHEMCMS_MAX_CONFIG_BYTES);

    my $file = File::Spec->catfile($dataDir, $target);
    my $tmp = File::Spec->catfile($dataDir, "$target.tmp");
    unlink($tmp);
    my $out;
    return "Temporaere Datei konnte nicht angelegt werden: $!"
        if (!sysopen($out, $tmp, O_WRONLY | O_CREAT | O_EXCL, 0640));
    binmode($out, ':raw');
    my $written = print {$out} $text;
    my $closeOk = close($out);
    if (!$written || !$closeOk) {
        my $writeError = "$!";
        unlink($tmp);
        return "Konfiguration konnte nicht geschrieben werden: $writeError";
    }

    # Backups sichern nur den veroeffentlichten Stand; Entwurf-Speicherungen erzeugen keine.
    if (!$isDraft && -e $file) {
        my $stamp = strftime('%Y%m%d-%H%M%S', localtime());
        my $backup = File::Spec->catfile($dataDir, "config.json.$stamp.bak");
        for (my $i = 1; -e $backup; $i++) {
            $backup = File::Spec->catfile($dataDir, "config.json.$stamp-$i.bak");
        }
        if (!copy($file, $backup)) {
            my $copyError = "$!";
            unlink($tmp);
            return "Backup konnte nicht angelegt werden: $copyError";
        }
    }

    if (!rename($tmp, $file)) {
        my $renameError = "$!";
        unlink($tmp);
        return "Konfiguration konnte nicht gespeichert werden: $renameError";
    }

    return undef if ($isDraft);
    my @backups = FHEMCMS_ListBackups($dataDir);
    for my $old (@backups[$FHEMCMS_MAX_BACKUPS .. $#backups]) {
        unlink(File::Spec->catfile($dataDir, $old));
    }
    return undef;
}

sub FHEMCMS_ListBackups {
    my ($dataDir) = @_;
    opendir(my $dh, $dataDir) or return ();
    my @files = grep { /\Aconfig\.json\.\d{8}-\d{6}(?:-\d+)?\.bak\z/ } readdir($dh);
    closedir($dh);
    return sort { $b cmp $a } @files;
}

sub FHEMCMS_RestoreBackup {
    my ($name, $dataDir, $backupName) = @_;
    return 'Ungueltiger Backup-Name'
        if (!defined($backupName) || $backupName !~ /\Aconfig\.json\.\d{8}-\d{6}(?:-\d+)?\.bak\z/);
    my ($text, $error) = FHEMCMS_ReadFile(File::Spec->catfile($dataDir, $backupName));
    return $error if (defined($error));
    my ($config, $parseError) = FHEMCMS_ParseConfig($text);
    return "Backup ist ungueltig: $parseError" if (defined($parseError));
    return FHEMCMS_WriteConfig($name, $dataDir, $config);
}

sub FHEMCMS_IsChildPath {
    my ($path, $parent) = @_;
    my $relative = File::Spec->abs2rel($path, $parent);
    return 0 if (File::Spec->file_name_is_absolute($relative));
    my @parts = File::Spec->splitdir($relative);
    return 0 if (!@parts || $relative eq File::Spec->curdir()
        || grep { $_ eq File::Spec->updir() } @parts);
    return 1;
}

sub FHEMCMS_PathError {
    my ($message, $path, $errors) = @_;
    my @details;
    for my $entry (@{$errors || []}) {
        next if (ref($entry) ne 'HASH');
        for my $errorPath (keys %{$entry}) {
            push(@details, defined($entry->{$errorPath}) ? $entry->{$errorPath} : 'unbekannter Fehler');
        }
    }
    my $detail = join('; ', @details);
    $detail = 'unbekannter Dateisystemfehler' if ($detail eq '');
    Log3('FHEMCMS', 1, "FHEMCMS: $message ($path): $detail");
    return "$message: $detail";
}

sub FHEMCMS_HtmlEscape {
    my ($value) = @_;
    $value =~ s/&/&amp;/g;
    $value =~ s/</&lt;/g;
    $value =~ s/>/&gt;/g;
    $value =~ s/"/&quot;/g;
    $value =~ s/'/&#39;/g;
    return $value;
}

1;
