package main;

use strict;
use warnings;
use Cwd qw(abs_path);
use Digest::MD5 qw(md5_hex);
use Digest::SHA qw(sha256_hex);
use Fcntl qw(O_CREAT O_EXCL O_WRONLY);
use File::Copy qw(copy);
use File::Path qw(make_path remove_tree);
use File::Spec;
use IO::Handle ();
use JSON::PP ();
use MIME::Base64 qw(decode_base64);
use POSIX qw(strftime);
use Time::Local ();

our $FHEMCMS_VERSION = '0.5.1-dev';
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
our $FHEMCMS_MAX_FREE_HTML = 20000;
our $FHEMCMS_MAX_MEDIA_BYTES = 3145728;
our $FHEMCMS_MAX_MEDIA_FILES = 200;
our $FHEMCMS_MAX_ICONS = 5000;
my $FHEMCMS_ICON_NAME = qr{\A(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]{0,79}\z};
my $FHEMCMS_MEDIA_NAME = qr/\A[0-9a-f]{32}\.(?:png|jpg|gif)\z/;

sub FHEMCMS_Initialize {
    my ($modHash) = @_;

    $modHash->{DefFn} = 'FHEMCMS_Define';
    $modHash->{UndefFn} = 'FHEMCMS_Undef';
    $modHash->{GetFn} = 'FHEMCMS_Get';
    $modHash->{SetFn} = 'FHEMCMS_Set';
    $modHash->{FW_summaryFn} = 'FHEMCMS_Summary';
    $modHash->{AttrList} = 'dbLog fileLog historySource:auto,dblog,filelog ' . ($readingFnAttributes // '');
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
    my ($hash, $name, $cmd, @args) = @_;
    $cmd //= '';

    return 'Die Daten dieses Devices wurden geloescht; bitte das Device loeschen oder FHEM neu starten'
        if (defined($name) && $FHEMCMS_PURGED{$name});

    if ($cmd eq 'logreadings') {
        return 'logreadings erwartet <device> [auto|dblog|filelog]' if (@args < 1 || @args > 2);
        return FHEMCMS_LogReadings($name, @args);
    }

    if ($cmd eq 'history') {
        return 'history erwartet <device> <reading> [24h|7d|30d|365d] [auto|raw|15m|1h|1d] [auto|dblog|filelog]'
            if (@args < 2 || @args > 5);
        return FHEMCMS_History($name, @args);
    }

    if ($cmd eq 'url') {
        return 'Ungueltiges Device'
            if (!defined($name) || $name ne ($hash->{NAME} // '') || !FHEMCMS_ValidName($name));
        my $basePath = $main::FW_ME || '/fhem';
        $basePath =~ s{/$}{};
        return $basePath . '/fhem-cms/' . $name . '/index.html';
    }

    if ($cmd eq 'migrationpreview') {
        return 'migrationpreview erwartet genau einen Base64-Parameter' if (@args != 1);
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        return 'Migrationsplan ist nicht Base64-kodiert' if (!defined($args[0]) || ref($args[0]));
        return 'Migrationsplan ist zu gross' if (length($args[0]) > 2 * $FHEMCMS_MAX_CONFIG_BYTES);
        return 'Migrationsplan ist nicht Base64-kodiert' if ($args[0] !~ /\A[A-Za-z0-9+\/]+={0,2}\z/);
        my $decoded = decode_base64($args[0]);
        return 'Migrationsplan ist zu gross' if (length($decoded) > $FHEMCMS_MAX_CONFIG_BYTES);
        my $plan = eval { JSON::PP->new->utf8->decode($decoded) };
        return 'Migrationsplan ist kein gueltiges JSON' if ($@ || !defined($plan));
        my ($error, $dataDir) = FHEMCMS_CreateDataDir($name);
        return $error if (defined($error));
        my ($candidate, $token, $previewError, $source) = FHEMCMS_PreviewLayoutMigration($dataDir, $plan);
        return $previewError if (defined($previewError));
        return JSON::PP->new->utf8->canonical->encode({config => $candidate, source => $source, token => $token});
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

    if ($cmd eq 'icons') {
        return JSON::PP->new->utf8->encode([FHEMCMS_ListIcons()]);
    }

    return 'Unknown argument ' . $cmd . ', choose one of url:noArg config:noArg draft:noArg status:noArg backups:noArg media:noArg icons:noArg logreadings history migrationpreview';
}

# Abgelehnte Schreibbefehle werden mit Befehl und Fehlertext protokolliert, nie mit den uebergebenen Inhalten.
sub FHEMCMS_Set {
    my ($hash, $name, $cmd, @args) = @_;
    my $result = FHEMCMS_SetCommand($hash, $name, $cmd, @args);
    if (defined($result) && length($result) && defined($cmd)
        && $cmd =~ /\A(?:config|draft|restore|publish|discard|media|purge|rebuild)\z/) {
        my $reason = substr($result, 0, 200);
        $reason =~ s/[\x00-\x1f\x7f]/ /g;
        Log3($name, 3, "FHEMCMS ($name): set $cmd abgewiesen: $reason");
    }
    return $result;
}

sub FHEMCMS_SetCommand {
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
        $error = FHEMCMS_LegacyWriteGuard($name, $dataDir, $cmd);
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
        $error = FHEMCMS_LegacyWriteGuard($name, $dataDir, $cmd);
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
        schemaVersion => 4,
        theme => 'dark',
        pages => [{id => 'start', title => 'Start', widgets => []}],
    };
}

sub FHEMCMS_EnsureConfig {
    my ($name, $dataDir) = @_;
    my $file = File::Spec->catfile($dataDir, 'config.json');
    return undef if (-e $file);
    return FHEMCMS_WriteConfig($name, $dataDir, FHEMCMS_DefaultConfig());
}

# Migriert Version 1 (Widget-IDs), Version 2 (48 Spalten) und Version 3 (Theme-Feld).
sub FHEMCMS_MigrateConfig {
    my ($config) = @_;
    return $config if (ref($config) ne 'HASH' || !defined($config->{schemaVersion})
        || ref($config->{schemaVersion}));
    return $config if (ref($config->{pages}) ne 'ARRAY');

    if ($config->{schemaVersion} eq '1') {
        for my $page (@{$config->{pages}}) {
            next if (ref($page) ne 'HASH' || ref($page->{widgets}) ne 'ARRAY');
            my $n = 0;
            for my $widget (@{$page->{widgets}}) {
                $n++;
                $widget->{id} = "w$n" if (ref($widget) eq 'HASH' && !exists($widget->{id}));
            }
        }
        $config->{schemaVersion} = 2;
    }

    if ($config->{schemaVersion} eq '2') {
        for my $page (@{$config->{pages}}) {
            next if (ref($page) ne 'HASH' || ref($page->{widgets}) ne 'ARRAY');
            for my $widget (@{$page->{widgets}}) {
                next if (ref($widget) ne 'HASH' || ref($widget->{grid}) ne 'HASH');
                $widget->{grid}{col} = ($widget->{grid}{col} - 1) * 4 + 1
                    if (defined($widget->{grid}{col}) && !ref($widget->{grid}{col})
                        && $widget->{grid}{col} =~ /\A[0-9]+\z/);
                $widget->{grid}{w} *= 4 if (defined($widget->{grid}{w}) && !ref($widget->{grid}{w})
                    && $widget->{grid}{w} =~ /\A[0-9]+\z/);
            }
        }
        if (ref($config->{navigation}) eq 'HASH' && ref($config->{navigation}{grid}) eq 'HASH') {
            $config->{navigation}{grid}{col} = ($config->{navigation}{grid}{col} - 1) * 4 + 1
                if (defined($config->{navigation}{grid}{col}) && !ref($config->{navigation}{grid}{col})
                    && $config->{navigation}{grid}{col} =~ /\A[0-9]+\z/);
            $config->{navigation}{grid}{w} *= 4
                if (defined($config->{navigation}{grid}{w}) && !ref($config->{navigation}{grid}{w})
                    && $config->{navigation}{grid}{w} =~ /\A[0-9]+\z/);
        }
        $config->{schemaVersion} = 3;
    }
    if ($config->{schemaVersion} eq '3') {
        $config->{theme} = 'dark' if (!exists($config->{theme}));
        $config->{schemaVersion} = 4;
    }
    return $config;
}

sub FHEMCMS_ValidateConfig {
    my ($config, $targetSchema) = @_;
    $targetSchema //= 4;
    return 'Nicht unterstuetzter Validierungsvertrag'
        if ($targetSchema ne '4' && $targetSchema ne '5');
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
    my $isBool = sub {
        my ($v) = @_;
        return JSON::PP::is_bool($v);
    };

    my $checkGrid = sub {
        my ($grid) = @_;
        my $gridError = $exact->($grid, 'grid', ['col', 'row', 'w', 'h']);
        return $gridError if ($gridError);
        my $columns = $targetSchema == 5 ? 12 : 48;
        return 'Ungueltige Rasterwerte'
            if (!$isInt->($grid->{col}, 1, $columns) || !$isInt->($grid->{row}, 1, 1000)
                || !$isInt->($grid->{w}, 1, $columns) || !$isInt->($grid->{h}, 1, 1000)
                || $grid->{col} + $grid->{w} > $columns + 1
                || ($targetSchema == 5 && $grid->{row} + $grid->{h} > 1001));
        return undef;
    };

    my $err = $exact->($config, 'Konfiguration', ['schemaVersion', 'pages'], ['navigation', 'theme', 'settings']);
    return $err if ($err);
    if (exists($config->{settings})) {
        $err = $exact->($config->{settings}, 'settings', [], ['showFrames', 'layoutMode', 'gridColumns']);
        return $err if ($err);
        return 'Ungueltiger Wert fuer layoutMode'
            if (exists($config->{settings}{layoutMode}) && (ref($config->{settings}{layoutMode})
                || !defined($config->{settings}{layoutMode})
                || $config->{settings}{layoutMode} !~ /\A(?:grid|flow|masonry|free)\z/));
        return 'Ungueltiger Wert fuer gridColumns'
            if (exists($config->{settings}{gridColumns}) && (ref($config->{settings}{gridColumns})
                || !defined($config->{settings}{gridColumns})
                || $config->{settings}{gridColumns} !~ /\A(?:12|24|48)\z/));
        return 'Ungueltiger Wert fuer showFrames'
            if (exists($config->{settings}{showFrames}) && !$isBool->($config->{settings}{showFrames}));
    }
    return 'Ungueltiges Theme'
        if (exists($config->{theme}) && (ref($config->{theme}) || !defined($config->{theme})
            || $config->{theme} !~ /\A(?:dark|light)\z/));
    if (exists($config->{navigation})) {
        $err = $exact->($config->{navigation}, 'navigation', ['orientation', 'grid'], ['items']);
        return $err if ($err);
        return 'Ungueltige Ausrichtung der Navigation'
            if (ref($config->{navigation}{orientation}) || !defined($config->{navigation}{orientation})
                || $config->{navigation}{orientation} !~ /\A(?:horizontal|vertical)\z/);
        $err = $checkGrid->($config->{navigation}{grid});
        return $err if ($err);
        if (exists($config->{navigation}{items})) {
            my $items = $config->{navigation}{items};
            return 'navigation.items muss eine Liste mit hoechstens 50 Eintraegen sein'
                if (ref($items) ne 'ARRAY' || @{$items} > 50);
            my %known = ref($config->{pages}) eq 'ARRAY'
                ? map { (ref($_) eq 'HASH' && defined($_->{id}) && !ref($_->{id})) ? ($_->{id} => 1) : () } @{$config->{pages}}
                : ();
            my %seenItem;
            for my $item (@{$items}) {
                $err = $exact->($item, 'Navigationseintrag', ['page'], ['label', 'width', 'height']);
                return $err if ($err);
                return 'Navigationseintrag verweist auf eine unbekannte Seite'
                    if (ref($item->{page}) || !defined($item->{page}) || !$known{$item->{page}});
                return 'Doppelter Navigationseintrag' if ($seenItem{$item->{page}}++);
                return 'Ungueltige Beschriftung'
                    if (exists($item->{label}) && (ref($item->{label}) || !defined($item->{label})
                        || length($item->{label}) < 1 || length($item->{label}) > 64
                        || $item->{label} =~ /[\x00-\x1f\x7f]/));
                return 'Ungueltige Breite'
                    if (exists($item->{width}) && !$isInt->($item->{width}, 40, 600));
                return 'Ungueltige Hoehe'
                    if (exists($item->{height}) && !$isInt->($item->{height}, 24, 200));
            }
        }
    }
    return 'Nicht unterstuetzte schemaVersion'
        if (!$isInt->($config->{schemaVersion}, $targetSchema, $targetSchema));
    if ($targetSchema == 5) {
        return 'Schema 5 erfordert Navigation und 12-Spalten-Raster'
            if (!exists($config->{navigation}) || !exists($config->{settings})
                || !defined($config->{settings}{layoutMode})
                || $config->{settings}{layoutMode} ne 'grid'
                || !defined($config->{settings}{gridColumns})
                || $config->{settings}{gridColumns} ne '12');
    }
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
        my @targetGrids = $targetSchema == 5 ? ($config->{navigation}{grid}) : ();
        for my $widget (@{$page->{widgets}}) {
            return 'Widget muss ein Objekt sein' if (ref($widget) ne 'HASH');
            return 'Unbekannter Widget-Typ'
                if (ref($widget->{type}) || !defined($widget->{type})
                    || ($widget->{type} ne 'fhem-value' && $widget->{type} ne 'thermostat'
                        && $widget->{type} ne 'text' && $widget->{type} ne 'fhem-html'
                        && $widget->{type} ne 'fhem-switch' && $widget->{type} ne 'fhem-button'
                        && $widget->{type} ne 'fhem-clock' && $widget->{type} ne 'fhem-icon'
                        && $widget->{type} ne 'fhem-table' && $widget->{type} ne 'fhem-slider'
                        && $widget->{type} ne 'fhem-chart' && $widget->{type} ne 'fhem-solarflow'));

            if ($widget->{type} eq 'text') {
                my $body = exists($widget->{html}) ? 'html' : 'markdown';
                $err = $exact->($widget, 'Widget', ['id', 'type', $body, 'grid'], ['title']);
            } elsif ($widget->{type} eq 'fhem-html') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'html', 'devices', 'grid'], ['title']);
            } elsif ($widget->{type} eq 'fhem-value') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'reading', 'grid'], ['title', 'unit', 'icon']);
            } elsif ($widget->{type} eq 'fhem-switch') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'reading', 'on', 'off', 'grid'],
                    ['title', 'icon', 'iconOff']);
            } elsif ($widget->{type} eq 'fhem-button') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'command', 'grid'],
                    ['title', 'label', 'icon']);
            } elsif ($widget->{type} eq 'fhem-clock') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'style', 'showSeconds', 'showDate', 'showWeekday', 'grid'],
                    ['title']);
            } elsif ($widget->{type} eq 'fhem-icon') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'reading', 'states', 'grid'], ['title']);
            } elsif ($widget->{type} eq 'fhem-table') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'rows', 'grid'], ['title', 'deviceLabel', 'sum', 'sumLabel', 'hideHeader', 'valueLabel', 'hideValueLabel', 'hideSumLabel', 'sumUnit']);
            } elsif ($widget->{type} eq 'fhem-chart') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'reading', 'grid'],
                    ['title', 'unit', 'range', 'granularity', 'source']);
            } elsif ($widget->{type} eq 'fhem-solarflow') {
                # 'device' mit Reading-Namen als Text ist das aeltere Format (ein gemeinsames Device);
                # invertGrid/invertBattery sind veraltet und wirkungslos, bleiben aber fuer gespeicherte Entwuerfe gueltig.
                $err = $exact->($widget, 'Widget', ['id', 'type', 'readings', 'grid'],
                    ['title', 'device', 'unit', 'invertGrid', 'invertBattery', 'threshold']);
            } elsif ($widget->{type} eq 'fhem-slider') {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'command', 'reading', 'grid'], ['title']);
            } else {
                $err = $exact->($widget, 'Widget', ['id', 'type', 'device', 'grid', 'readings'], ['title']);
            }
            return $err if ($err);

            return 'Ungueltige Widget-ID'
                if (ref($widget->{id}) || !defined($widget->{id}) || $widget->{id} !~ $id);
            return 'Widget-ID __nav ist fuer die Navigation reserviert'
                if ($targetSchema == 5 && $widget->{id} eq '__nav');
            return "Doppelte Widget-ID '$widget->{id}'" if ($widgetIds{$widget->{id}}++);
            return 'Ungueltiger Widget-Titel'
                if (exists($widget->{title})
                    && (ref($widget->{title}) || !defined($widget->{title})
                        || length($widget->{title}) > 64 || $widget->{title} =~ /[\x00-\x1f\x7f]/));

            if ($widget->{type} eq 'text' && exists($widget->{html})) {
                my $htmlError = FHEMCMS_ValidateHtml($widget->{html});
                return "Ungueltiger HTML-Text: $htmlError" if (defined($htmlError));
                my %placeholderDevice = map { $_ => 1 } ($widget->{html} =~ /\{\{\s*([A-Za-z0-9_.-]+):/g);
                return 'Zu viele Devices in Platzhaltern (hoechstens 20)' if (keys(%placeholderDevice) > 20);
            } elsif ($widget->{type} eq 'text') {
                my $text = $widget->{markdown};
                return 'Ungueltiger Markdown-Text'
                    if (ref($text) || !defined($text) || length($text) > $FHEMCMS_MAX_TEXT
                        || $text =~ /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
            } elsif ($widget->{type} eq 'fhem-html') {
                my $freeError = FHEMCMS_ValidateFreeHtml($widget->{html});
                return "Ungueltiger HTML-Code: $freeError" if (defined($freeError));
                return 'devices muss eine Liste mit hoechstens 20 Devices sein'
                    if (ref($widget->{devices}) ne 'ARRAY' || @{$widget->{devices}} > 20);
                my %seenDevice;
                for my $name (@{$widget->{devices}}) {
                    return 'Ungueltiger Wert fuer devices' if (!$isName->($name));
                    return 'Doppeltes Device in devices' if ($seenDevice{$name}++);
                }
            } elsif ($widget->{type} ne 'fhem-clock' && $widget->{type} ne 'fhem-table'
                && !($widget->{type} eq 'fhem-solarflow' && !exists($widget->{device}))) {
                return 'Ungueltiger Wert fuer device' if (!$isName->($widget->{device}));
            }

            if ($widget->{type} eq 'text' || $widget->{type} eq 'fhem-html') {
                # keine weiteren Felder
            } elsif ($widget->{type} eq 'fhem-button') {
                return 'Ungueltiger Wert fuer command' if (!$isName->($widget->{command}));
                return 'Ungueltige Beschriftung'
                    if (exists($widget->{label})
                        && (ref($widget->{label}) || !defined($widget->{label})
                            || length($widget->{label}) < 1 || length($widget->{label}) > 32
                            || $widget->{label} =~ /[\x00-\x1f\x7f]/));
                return 'Ungueltiges Icon'
                    if (exists($widget->{icon})
                        && (ref($widget->{icon}) || !defined($widget->{icon})
                            || $widget->{icon} !~ $FHEMCMS_ICON_NAME));
            } elsif ($widget->{type} eq 'fhem-switch') {
                for my $field ('reading', 'on', 'off') {
                    return "Ungueltiger Wert fuer $field" if (!$isName->($widget->{$field}));
                }
                return 'on und off muessen verschieden sein' if ($widget->{on} eq $widget->{off});
                for my $field ('icon', 'iconOff') {
                    return 'Ungueltiges Icon'
                        if (exists($widget->{$field})
                            && (ref($widget->{$field}) || !defined($widget->{$field})
                                || $widget->{$field} !~ $FHEMCMS_ICON_NAME));
                }
            } elsif ($widget->{type} eq 'fhem-value') {
                return 'Ungueltiger Wert fuer reading' if (!$isName->($widget->{reading}));
                return 'Ungueltige Einheit'
                    if (exists($widget->{unit})
                        && (ref($widget->{unit}) || !defined($widget->{unit})
                            || length($widget->{unit}) < 1 || length($widget->{unit}) > 16
                            || $widget->{unit} =~ /[\x00-\x1f\x7f]/));
                return 'Ungueltiges Icon'
                    if (exists($widget->{icon})
                        && (ref($widget->{icon}) || !defined($widget->{icon})
                            || $widget->{icon} !~ $FHEMCMS_ICON_NAME));
            } elsif ($widget->{type} eq 'fhem-chart') {
                for my $field ('device', 'reading') {
                    return "Ungueltiger Wert fuer $field" if (!$isName->($widget->{$field}));
                }
                return 'Ungueltige Einheit'
                    if (exists($widget->{unit})
                        && (ref($widget->{unit}) || !defined($widget->{unit})
                            || length($widget->{unit}) < 1 || length($widget->{unit}) > 16
                            || $widget->{unit} =~ /[\x00-\x1f\x7f]/));
                for my $option (['range', qr/\A(?:24h|7d|30d|365d)\z/], ['granularity', qr/\A(?:auto|raw|15m|1h|1d)\z/],
                    ['source', qr/\A(?:auto|dblog|filelog)\z/]) {
                    my ($field, $pattern) = @{$option};
                    return "Ungueltiger Wert fuer $field"
                        if (exists($widget->{$field})
                            && (ref($widget->{$field}) || !defined($widget->{$field}) || $widget->{$field} !~ $pattern));
                }
            } elsif ($widget->{type} eq 'fhem-slider') {
                for my $field ('command', 'reading') {
                    return "Ungueltiger Wert fuer $field" if (!$isName->($widget->{$field}));
                }
            } elsif ($widget->{type} eq 'fhem-clock') {
                return 'Ungueltige Uhr-Darstellung'
                    if (ref($widget->{style}) || !defined($widget->{style})
                        || $widget->{style} !~ /\A(?:digital|date|analog)\z/);
                for my $field ('showSeconds', 'showDate', 'showWeekday') {
                    return "Ungueltiger Wert fuer $field" if (!$isBool->($widget->{$field}));
                }
            } elsif ($widget->{type} eq 'fhem-solarflow') {
                $err = $exact->($widget->{readings}, 'readings', ['pv'], ['home', 'grid', 'battery', 'soc']);
                return $err if ($err);
                my %seenSource;
                for my $field (sort keys %{$widget->{readings}}) {
                    my $source = $widget->{readings}{$field};
                    if (exists($widget->{device})) {
                        return "Ungueltiger Wert fuer readings.$field" if (!$isName->($source));
                        next;
                    }
                    $err = $exact->($source, "readings.$field", ['device', 'reading']);
                    return $err if ($err);
                    return "Ungueltiger Wert fuer readings.$field.device" if (!$isName->($source->{device}));
                    return "Ungueltiger Wert fuer readings.$field.reading" if (!$isName->($source->{reading}));
                    $seenSource{$source->{device}} = 1;
                }
                return 'Zu viele Devices (hoechstens 5)' if (keys(%seenSource) > 5);
                return 'Ungueltige Einheit'
                    if (exists($widget->{unit})
                        && (ref($widget->{unit}) || !defined($widget->{unit}) || $widget->{unit} !~ /\A(?:W|kW)\z/));
                for my $field ('invertGrid', 'invertBattery') {
                    return "Ungueltiger Wert fuer $field" if (exists($widget->{$field}) && !$isBool->($widget->{$field}));
                }
                return 'Ungueltiger Schwellwert'
                    if (exists($widget->{threshold}) && !$isInt->($widget->{threshold}, 0, 1000));
            } elsif ($widget->{type} eq 'fhem-icon') {
                return 'Ungueltiger Wert fuer reading' if (!$isName->($widget->{reading}));
                my $states = $widget->{states};
                return 'states muss eine Liste mit 1 bis 20 Eintraegen sein'
                    if (ref($states) ne 'ARRAY' || @{$states} < 1 || @{$states} > 20);
                my %seenValue;
                for my $state (@{$states}) {
                    $err = $exact->($state, 'Status-Zuordnung', ['value', 'icon', 'color']);
                    return $err if ($err);
                    return 'Ungueltiger Wert fuer states.value'
                        if (ref($state->{value}) || !defined($state->{value})
                            || length($state->{value}) < 1 || length($state->{value}) > 64
                            || $state->{value} =~ /[\x00-\x1f\x7f]/);
                    return 'Doppelter Wert in states' if ($seenValue{$state->{value}}++);
                    return 'Ungueltiges Icon'
                        if (ref($state->{icon}) || !defined($state->{icon})
                            || $state->{icon} !~ $FHEMCMS_ICON_NAME);
                    return 'Ungueltige Farbe'
                        if (ref($state->{color}) || !defined($state->{color})
                            || $state->{color} !~ /\A#[0-9a-fA-F]{6}\z/);
                }
            } elsif ($widget->{type} eq 'fhem-table') {
                return 'Ungueltiger Wert fuer sum'
                    if (exists($widget->{sum}) && !$isBool->($widget->{sum}));
                for my $flag ('hideHeader', 'hideValueLabel', 'hideSumLabel') {
                    return "Ungueltiger Wert fuer $flag" if (exists($widget->{$flag}) && !$isBool->($widget->{$flag}));
                }
                return 'Ungueltige Wertespalten-Beschriftung'
                    if (exists($widget->{valueLabel})
                        && (ref($widget->{valueLabel}) || !defined($widget->{valueLabel})
                            || length($widget->{valueLabel}) < 1 || length($widget->{valueLabel}) > 32
                            || $widget->{valueLabel} =~ /[\x00-\x1f\x7f]/));
                return 'Ungueltige Summen-Einheit'
                    if (exists($widget->{sumUnit})
                        && (ref($widget->{sumUnit}) || !defined($widget->{sumUnit})
                            || length($widget->{sumUnit}) > 16 || $widget->{sumUnit} =~ /[\x00-\x1f\x7f]/));
                return 'Ungueltige Summen-Beschriftung'
                    if (exists($widget->{sumLabel})
                        && (ref($widget->{sumLabel}) || !defined($widget->{sumLabel})
                            || length($widget->{sumLabel}) < 1 || length($widget->{sumLabel}) > 32
                            || $widget->{sumLabel} =~ /[\x00-\x1f\x7f]/));
                return 'Ungueltige Tabellen-Bezeichnung'
                    if (exists($widget->{deviceLabel})
                        && (ref($widget->{deviceLabel}) || !defined($widget->{deviceLabel})
                            || length($widget->{deviceLabel}) < 1 || length($widget->{deviceLabel}) > 32
                            || $widget->{deviceLabel} =~ /[\x00-\x1f\x7f]/));
                my $rows = $widget->{rows};
                return 'rows muss eine Liste mit 1 bis 40 Eintraegen sein'
                    if (ref($rows) ne 'ARRAY' || @{$rows} < 1 || @{$rows} > 40);
                my %seenReading;
                for my $row (@{$rows}) {
                    $err = $exact->($row, 'Tabellenzeile', ['device', 'reading'], ['unit', 'label']);
                    return $err if ($err);
                    return 'Ungueltiger Wert fuer rows.device' if (!$isName->($row->{device}));
                    return 'Ungueltiger Wert fuer rows.reading' if (!$isName->($row->{reading}));
                    return 'Ungueltiger Bezeichner in rows'
                        if (exists($row->{label})
                            && (ref($row->{label}) || !defined($row->{label})
                                || length($row->{label}) < 1 || length($row->{label}) > 32
                                || $row->{label} =~ /[\x00-\x1f\x7f]/));
                    return 'Ungueltige Einheit in rows'
                        if (exists($row->{unit})
                            && (ref($row->{unit}) || !defined($row->{unit})
                                || length($row->{unit}) < 1 || length($row->{unit}) > 16
                                || $row->{unit} =~ /[\x00-\x1f\x7f]/));
                    my $key = $row->{device} . "\0" . $row->{reading};
                    return 'Doppelte Device/Reading-Kombination in rows' if ($seenReading{$key}++);
                }
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
            if ($targetSchema == 5) {
                my $grid = $widget->{grid};
                for my $other (@targetGrids) {
                    return 'Ueberschneidung im 12-Spalten-Raster'
                        if ($grid->{col} < $other->{col} + $other->{w}
                            && $other->{col} < $grid->{col} + $grid->{w}
                            && $grid->{row} < $other->{row} + $other->{h}
                            && $other->{row} < $grid->{row} + $grid->{h});
                }
                push(@targetGrids, $grid);
            }
        }
    }
    return undef;
}

# Freies HTML (fhem-html): strenge Allowlist fuer Elemente und Attribute; kein Skript, keine
# Ereignis-Attribute, keine Ressourcen. Platzhalter {{Device:reading}} sind reiner Text.
sub FHEMCMS_ValidateFreeHtml {
    my ($html) = @_;
    return 'kein Text' if (ref($html) || !defined($html));
    return 'zu lang' if (length($html) > $FHEMCMS_MAX_FREE_HTML);
    return 'enthaelt Steuerzeichen' if ($html =~ /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);

    my %tags = map { $_ => 1 } qw(div span p h1 h2 h3 h4 strong b em i u small br hr ul ol li
        table thead tbody tr th td style);
    my %attrs = map { $_ => 1 } qw(class style title colspan rowspan data-cms-class device reading filter);
    my $badCss = qr{\@import|url\s*\(|expression|behavior|binding|javascript:|position\s*:\s*(?:fixed|sticky)|\\}i;

    # Kommentare, CDATA und Verarbeitungsanweisungen gibt es nicht.
    return 'Kommentare und Sonderkonstrukte sind nicht erlaubt' if ($html =~ /<(?:!|\?)/);

    my $rest = $html;
    while ($rest =~ /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9-]*\s*=\s*"[^"]*")*)\s*(\/?)>/g) {
        my ($close, $tag, $attrText) = ($1, lc($2), $3);
        return "Element <$tag> nicht erlaubt" if (!$tags{$tag});
        return 'Attribute in Endtag' if ($close && $attrText ne '');
        my %seen;
        while ($attrText =~ /\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*"([^"]*)"/g) {
            my ($name, $value) = (lc($1), $2);
            return "Attribut '$name' nicht erlaubt" if (!$attrs{$name});
            $seen{$name} = 1;
            return 'Ungueltiges style-Attribut' if ($name eq 'style' && $value =~ $badCss);
            return 'Ungueltiges class-Attribut' if ($name eq 'class' && $value !~ /\A[A-Za-z0-9_ -]{0,200}\z/);
            return 'Ungueltiges colspan/rowspan' if (($name eq 'colspan' || $name eq 'rowspan') && $value !~ /\A[1-9][0-9]?\z/);
            return 'Ungueltiger Device-Name im Attribut device' if ($name eq 'device' && $value !~ /\A[A-Za-z0-9_.-]{1,64}\z/);
            return 'Ungueltiger Reading-Name im Attribut reading' if ($name eq 'reading' && $value !~ /\A\@?[A-Za-z0-9_.-]{1,64}\z/);
            return 'Ungueltiger Filter im Attribut filter'
                if ($name eq 'filter' && $value !~ /\A\s*(?:[a-z]+(?:\([^()|{}"<>]{0,80}\))?(?:\s*\|\s*[a-z]+(?:\([^()|{}"<>]{0,80}\))?)*)?\s*\z/);
            if ($name eq 'data-cms-class') {
                for my $part (grep { $_ ne '' && $_ !~ /\A\s*\z/ } split(/;/, $value)) {
                    return 'Ungueltige Bedingung in data-cms-class'
                        if ($part !~ /\A\s*[A-Za-z0-9_.-]+:\@?[A-Za-z0-9_.-]+\s*(?:>=|<=|!=|=|>|<)\s*[^:;<>"]{0,40}?\s*:\s*[A-Za-z0-9_-]{1,40}\s*\z/);
                }
            }
        }
        return 'Die Attribute device und reading gehoeren zusammen' if (!!$seen{device} != !!$seen{reading});
    }
    # Jedes verbliebene '<' muss zu einem erlaubten Tag gehoeren (oben geprueft); nackte '<' oder '>' in Attributen sind unzulaessig.
    my $stripped = $html;
    $stripped =~ s/<\/?[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9-]*\s*=\s*"[^"]*")*\s*\/?>//g;
    return 'unvollstaendiges oder ungueltiges Element' if ($stripped =~ /</);
    while ($html =~ m{<style(?:\s[^>]*)?>(.*?)</style>}gis) {
        return 'Ungueltiges style-Element' if ($1 =~ $badCss);
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
        map { 'cms-w-' . $_ } 1 .. 100;
    my %tags = (
        p => {class => \%align}, h1 => {class => \%align}, h2 => {class => \%align},
        h3 => {class => \%align}, blockquote => {class => \%align},
        th => {class => \%align}, td => {class => \%align},
        strong => {}, em => {}, u => {}, s => {}, code => {}, span => {style => 1}, ul => {}, ol => {}, li => {},
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
                } elsif ($attr eq 'style') {
                    return 'ungueltige Farbe'
                        if ($value !~ /\A(?:color:\#[0-9a-f]{6}(?:;background-color:\#[0-9a-f]{6})?|background-color:\#[0-9a-f]{6})\z/);
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

# Logische Icon-Namen (wie FHEMWEB sie unter /icons/<name> ausliefert) aus www/images/<Stil>/.
sub FHEMCMS_ListIcons {
    my $modPath = $main::attr{global}{modpath};
    return () if (!defined($modPath) || $modPath eq '');
    my $imageDir = File::Spec->catdir($modPath, 'www', 'images');
    my %names;
    my $scan;
    $scan = sub {
        my ($dir, $prefix, $depth) = @_;
        return if ($depth > 4 || keys(%names) >= $FHEMCMS_MAX_ICONS);
        opendir(my $dh, $dir) or return;
        my @entries = sort grep { $_ !~ /\A\./ } readdir($dh);
        closedir($dh);
        for my $entry (@entries) {
            my $path = File::Spec->catfile($dir, $entry);
            next if (-l $path);
            if (-d $path) {
                $scan->($path, $prefix . $entry . '/', $depth + 1);
            } elsif ($entry =~ /\A(.+)\.(?:svg|png|gif|jpe?g)\z/i) {
                my $logical = $prefix . $1;
                next if ($logical !~ $FHEMCMS_ICON_NAME || $logical =~ m{\A(?:weather/|dashboardicons|fhemicon|favicon)});
                $names{$logical} = 1;
            }
        }
    };
    if (opendir(my $dh, $imageDir)) {
        my @styles = sort grep { $_ !~ /\A\./ && -d File::Spec->catdir($imageDir, $_) && !-l File::Spec->catdir($imageDir, $_) } readdir($dh);
        closedir($dh);
        $scan->(File::Spec->catdir($imageDir, $_), '', 0) for @styles;
    }
    return sort keys %names;
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

# Verlauf aus DbLog oder FileLog (wie TemperatureCollector); Zeitraum, Punktezahl und gelesene Zeilen sind begrenzt.
our %FHEMCMS_HISTORY_CACHE;
our $FHEMCMS_HISTORY_CACHE_SECONDS = 30;
our $FHEMCMS_HISTORY_MAX_POINTS = 400;
our $FHEMCMS_HISTORY_MAX_LINES = 2000000;
our $FHEMCMS_HISTORY_MAX_ROWS = 500000;
my %FHEMCMS_HISTORY_HOURS = ('24h' => 24, '7d' => 168, '30d' => 720, '365d' => 8760);
my %FHEMCMS_HISTORY_STEPS = (auto => 0, raw => 0, '15m' => 15, '1h' => 60, '1d' => 1440);
my @FHEMCMS_HISTORY_NICE_STEPS = (1, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440);

sub FHEMCMS_LogDevices {
    my ($cmsName, $type, $attribute) = @_;
    my $configured = $main::attr{$cmsName}{$attribute} // '';
    if ($configured ne '') {
        my $def = $main::defs{$configured};
        return (ref($def) eq 'HASH' && ($def->{TYPE} // '') eq $type) ? ($def) : ();
    }
    return grep { ref($_) eq 'HASH' && ($_->{TYPE} // '') eq $type }
        map { $main::defs{$_} } sort keys %main::defs;
}

sub FHEMCMS_FileLogMatches {
    my ($fileLog, $device, $reading) = @_;
    my $regexp = $fileLog->{REGEXP};
    return 0 if (!defined($regexp));
    return eval { "$device:$reading: 0" =~ /\A(?:$regexp)\z/ } ? 1 : 0;
}

sub FHEMCMS_FileLogFiles {
    my ($fileLog, $from, $to) = @_;
    return () if (!defined($fileLog->{logfile}));
    my $logdir = ($main::attr{global} && $main::attr{global}{logdir}) || './log';
    my %files;
    for (my $day = $from - ($from % 86400); $day <= $to + 86400; $day += 86400) {
        my $file = $fileLog->{logfile};
        $file =~ s/%L/$logdir/g;
        $file = strftime($file, localtime($day));
        $files{$file} = 1 if (-f $file && -r $file);
    }
    return sort keys %files;
}

# Liest passende FileLog-Zeilen; $onLine erhaelt (epoch, reading, value).
sub FHEMCMS_ScanFileLog {
    my ($fileLog, $device, $from, $to, $onLine) = @_;
    my $lines = 0;
    my $truncated = 0;
    FILE: for my $file (FHEMCMS_FileLogFiles($fileLog, $from, $to)) {
        open(my $fh, '<', $file) or next;
        while (my $line = <$fh>) {
            if (++$lines > $FHEMCMS_HISTORY_MAX_LINES) {
                $truncated = 1;
                close($fh);
                last FILE;
            }
            next if (index($line, " $device ") < 0);
            next if ($line !~ /\A(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2}):(\d{2})\s+\Q$device\E\s+([A-Za-z0-9_.-]+):\s*(\S+)/);
            my $epoch = eval { Time::Local::timelocal($6, $5, $4, $3, $2 - 1, $1) };
            next if (!defined($epoch) || $epoch < $from || $epoch > $to);
            $onLine->($epoch, $7, $8);
        }
        close($fh);
    }
    return $truncated;
}

sub FHEMCMS_DbLogCall {
    my ($dbLog, @args) = @_;
    return (undef, 'DbLog ist nicht verfuegbar') if (!defined(&DbLog_Get));
    local $@;
    my @result = eval { DbLog_Get($dbLog, $dbLog->{NAME}, '-', @args) };
    return (undef, 'DbLog-Abfrage fehlgeschlagen') if ($@);
    return (\@result, undef);
}

sub FHEMCMS_ReadingNumber {
    my ($value) = @_;
    return undef if (!defined($value) || $value !~ /\A\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
    return $1 + 0;
}

# Liefert die Quelle fuer ein Device/Reading: ('dblog', $hash), ('filelog', $hash) oder (undef, Fehlertext).
sub FHEMCMS_HistorySource {
    my ($cmsName, $source, $device, $reading) = @_;
    my $mode = ($source // 'auto') eq 'auto' ? ($main::attr{$cmsName}{historySource} // 'auto') : $source;
    $mode = 'auto' if ($mode !~ /\A(?:auto|dblog|filelog)\z/);
    if ($mode ne 'filelog' && defined(&DbLog_Get)) {
        my ($dbLog) = FHEMCMS_LogDevices($cmsName, 'DbLog', 'dbLog');
        return ('dblog', $dbLog) if ($dbLog);
    }
    return (undef, 'Kein DbLog-Device gefunden') if ($mode eq 'dblog');
    if ($mode ne 'dblog') {
        for my $fileLog (FHEMCMS_LogDevices($cmsName, 'FileLog', 'fileLog')) {
            return ('filelog', $fileLog) if (!defined($reading) || FHEMCMS_FileLogMatches($fileLog, $device, $reading));
        }
    }
    return (undef, 'Kein passendes FileLog-Device gefunden');
}

# get <cms> logreadings <device> [auto|dblog|filelog]: Readings, die zu dem Device protokolliert werden.
sub FHEMCMS_LogReadings {
    my ($cmsName, $device, $source) = @_;
    return 'Ungueltiges Device' if (!FHEMCMS_ValidName($device));
    $source //= 'auto';
    return 'Ungueltige Quelle' if ($source !~ /\A(?:auto|dblog|filelog)\z/);
    my $json = JSON::PP->new->utf8->canonical;

    if ($source ne 'filelog' && defined(&DbLog_Get)) {
        my ($dbLog) = FHEMCMS_LogDevices($cmsName, 'DbLog', 'dbLog');
        if ($dbLog) {
            my ($result, $error) = FHEMCMS_DbLogCall($dbLog, 'webchart', '2000-01-01_00:00:00', '2099-12-31_23:59:59',
                $device, 'getreadings');
            if (!$error) {
                my $data = eval { JSON::PP::decode_json(join('', grep { defined($_) && !ref($_) } @{$result})) };
                my @readings = ref($data) eq 'HASH' && ref($data->{data}) eq 'ARRAY'
                    ? sort grep { defined($_) && /\A[A-Za-z0-9_.-]{1,128}\z/ }
                        map { ref($_) eq 'HASH' ? $_->{READING} : undef } @{$data->{data}}
                    : ();
                return $json->encode({source => 'dblog', readings => \@readings}) if (@readings || $source eq 'dblog');
            } elsif ($source eq 'dblog') {
                return $error;
            }
        } elsif ($source eq 'dblog') {
            return 'Kein DbLog-Device gefunden';
        }
    }

    my (%seen, $any);
    my $now = time();
    for my $fileLog (FHEMCMS_LogDevices($cmsName, 'FileLog', 'fileLog')) {
        $any = 1;
        FHEMCMS_ScanFileLog($fileLog, $device, $now - 7 * 86400, $now, sub { $seen{$_[1]} = 1; });
    }
    return 'Kein DbLog- oder FileLog-Device gefunden' if (!$any);
    return $json->encode({source => 'filelog', readings => [sort keys %seen]});
}

sub FHEMCMS_HistoryRows {
    my ($cmsName, $kind, $logHash, $device, $reading, $from, $to) = @_;
    my (@rows, $truncated);
    if ($kind eq 'filelog') {
        $truncated = FHEMCMS_ScanFileLog($logHash, $device, $from, $to, sub {
            return if ($_[1] ne $reading);
            my $number = FHEMCMS_ReadingNumber($_[2]);
            push(@rows, [$_[0], $number]) if (defined($number) && @rows < $FHEMCMS_HISTORY_MAX_ROWS);
        });
        return (\@rows, $truncated, undef);
    }
    my ($result, $error) = FHEMCMS_DbLogCall($logHash, 'array',
        strftime('%Y-%m-%d_%H:%M:%S', localtime($from)), strftime('%Y-%m-%d_%H:%M:%S', localtime($to)),
        "$device:$reading");
    return (undef, 0, $error) if ($error);
    for my $row (@{$result}) {
        next if (ref($row) ne 'HASH' || ($row->{tstamp} // '') !~ /\A(\d{4})-(\d{2})-(\d{2})[_ ](\d{2}):(\d{2}):(\d{2})/);
        my $epoch = eval { Time::Local::timelocal($6, $5, $4, $3, $2 - 1, $1) };
        my $number = FHEMCMS_ReadingNumber($row->{value});
        next if (!defined($epoch) || !defined($number));
        if (@rows >= $FHEMCMS_HISTORY_MAX_ROWS) {
            $truncated = 1;
            last;
        }
        push(@rows, [$epoch, $number]);
    }
    return (\@rows, $truncated, undef);
}

# get <cms> history <device> <reading> <24h|7d|30d|365d> <auto|raw|15m|1h|1d> [auto|dblog|filelog]
sub FHEMCMS_History {
    my ($cmsName, $device, $reading, $range, $granularity, $source) = @_;
    return 'Ungueltiges Device' if (!FHEMCMS_ValidName($device));
    return 'Ungueltiges Reading' if (!defined($reading) || $reading !~ /\A[A-Za-z0-9_.-]{1,128}\z/);
    $range //= '24h';
    $granularity //= 'auto';
    $source //= 'auto';
    return 'Ungueltiger Zeitraum' if (!exists($FHEMCMS_HISTORY_HOURS{$range}));
    return 'Ungueltige Granularitaet' if (!exists($FHEMCMS_HISTORY_STEPS{$granularity}));
    return 'Ungueltige Quelle' if ($source !~ /\A(?:auto|dblog|filelog)\z/);

    my $key = join("\0", $cmsName, $device, $reading, $range, $granularity, $source);
    my $cached = $FHEMCMS_HISTORY_CACHE{$key};
    return $cached->{json} if ($cached && time() - $cached->{time} < $FHEMCMS_HISTORY_CACHE_SECONDS);

    my ($kind, $logHash) = FHEMCMS_HistorySource($cmsName, $source, $device, $reading);
    return $logHash if (!$kind);

    my $to = time();
    my $hours = $FHEMCMS_HISTORY_HOURS{$range};
    my $from = $to - $hours * 3600;
    my ($rows, $truncated, $error) = FHEMCMS_HistoryRows($cmsName, $kind, $logHash, $device, $reading, $from, $to);
    if ($error) {
        Log3($cmsName, 2, "FHEMCMS ($cmsName): Verlauf von $device:$reading nicht lesbar: $error");
        return $error;
    }

    my @rows = sort { $a->[0] <=> $b->[0] } @{$rows};
    my $minStep = 1;
    for my $candidate (@FHEMCMS_HISTORY_NICE_STEPS) {
        $minStep = $candidate;
        last if ($hours * 60 / $candidate <= $FHEMCMS_HISTORY_MAX_POINTS);
    }
    my $step = $FHEMCMS_HISTORY_STEPS{$granularity};
    $step = 0 if ($granularity eq 'raw' && @rows <= $FHEMCMS_HISTORY_MAX_POINTS);
    $step = $minStep if ($granularity eq 'auto' || ($step > 0 && $step < $minStep)
        || ($granularity eq 'raw' && @rows > $FHEMCMS_HISTORY_MAX_POINTS));

    my @points;
    if ($step == 0) {
        @points = map { [$_->[0], $_->[1], $_->[1], $_->[1]] } @rows;
    } else {
        my %buckets;
        my @order;
        for my $row (@rows) {
            my $id = int($row->[0] / ($step * 60));
            my $bucket = $buckets{$id};
            if (!$bucket) {
                $bucket = $buckets{$id} = {count => 0, time => 0, sum => 0, min => $row->[1], max => $row->[1]};
                push(@order, $id);
            }
            $bucket->{count}++;
            $bucket->{time} += $row->[0];
            $bucket->{sum} += $row->[1];
            $bucket->{min} = $row->[1] if ($row->[1] < $bucket->{min});
            $bucket->{max} = $row->[1] if ($row->[1] > $bucket->{max});
        }
        @points = map {
            my $bucket = $buckets{$_};
            [int($bucket->{time} / $bucket->{count}), $bucket->{sum} / $bucket->{count}, $bucket->{min}, $bucket->{max}]
        } @order;
    }
    for my $point (@points) {
        $_ = sprintf('%.4f', $_) + 0 for (@{$point}[1 .. 3]);
    }

    my $text = JSON::PP->new->utf8->canonical->encode({
        source => $kind, from => $from, to => $to, step => $step, rows => scalar(@rows),
        truncated => ($truncated ? JSON::PP::true : JSON::PP::false), points => \@points,
    });
    %FHEMCMS_HISTORY_CACHE = () if (keys(%FHEMCMS_HISTORY_CACHE) > 50);
    $FHEMCMS_HISTORY_CACHE{$key} = {time => time(), json => $text};
    return $text;
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

# Alte Schreibbefehle duerfen unbekannte Formate nicht ersetzen oder verwerfen.
sub FHEMCMS_LegacyWriteGuard {
    my ($name, $dataDir, $command) = @_;
    for my $entry (['config.json', 'Live-Konfiguration'], ['draft.json', 'Entwurf']) {
        my ($file, $label) = @{$entry};
        my $path = File::Spec->catfile($dataDir, $file);
        next if (!-e $path);
        my ($text, $error) = FHEMCMS_ReadFile($path);
        return "$label kann nicht geprueft werden: $error" if (defined($error));
        my $config = eval { JSON::PP->new->utf8->decode($text) };
        my $decodeFailed = $@ ne '';
        if ($decodeFailed || !defined($config) || ref($config) ne 'HASH') {
            # Wiederherstellen und explizites Verwerfen bleiben bei kaputtem JSON moeglich.
            if ($command eq 'restore' || $command eq 'discard') {
                Log3($name, 3, "FHEMCMS ($name): Format von $label nicht pruefbar; $command wird weiter geprueft");
                next;
            }
            return "$label ist ungueltig: Konfiguration ist kein gueltiges JSON";
        }
        my $version = $config->{schemaVersion};
        return "$label hat eine nicht unterstuetzte schemaVersion; alter Schreibbefehl abgelehnt"
            if (!defined($version) || ref($version) || $version !~ /\A[0-9]{1,6}\z/
                || !($version eq '1' || $version eq '2' || $version eq '3' || $version == 4));
    }
    return undef;
}

# Rein vorbereitend: Schema 5 wird weder von der bestehenden API angenommen noch gespeichert.
sub FHEMCMS_PrepareLayoutMigration {
    my ($source, $positions) = @_;
    my $error = FHEMCMS_ValidateConfig($source);
    return (undef, "Ausgangskonfiguration ist ungueltig: $error") if (defined($error));
    return (undef, 'Ungueltiger Migrationsplan')
        if (ref($positions) ne 'HASH' || keys(%{$positions}) != 2
            || !exists($positions->{navigation}) || ref($positions->{pages}) ne 'ARRAY'
            || @{$positions->{pages}} != @{$source->{pages}});

    my $checkGrid = sub {
        my ($grid) = @_;
        return 0 if (ref($grid) ne 'HASH' || keys(%{$grid}) != 4);
        for my $key (qw(col row w h)) {
            return 0 if (!exists($grid->{$key}) || !defined($grid->{$key}) || ref($grid->{$key})
                || $grid->{$key} !~ /\A[0-9]{1,6}\z/ || $grid->{$key} < 1);
        }
        return $grid->{col} + $grid->{w} <= 13 && $grid->{row} + $grid->{h} <= 1001;
    };
    return (undef, 'Ungueltige Navigationsposition') if (!$checkGrid->($positions->{navigation}));

    my %pages;
    for my $page (@{$positions->{pages}}) {
        return (undef, 'Ungueltige Seite im Migrationsplan')
            if (ref($page) ne 'HASH' || keys(%{$page}) != 2 || !defined($page->{id})
                || ref($page->{id}) || $page->{id} !~ /\A[A-Za-z0-9_-]{1,64}\z/
                || ref($page->{widgets}) ne 'ARRAY' || $pages{$page->{id}});
        $pages{$page->{id}} = $page;
    }

    my $json = JSON::PP->new->utf8->canonical;
    my $candidate = $json->decode($json->encode($source));
    $candidate->{schemaVersion} = 5;
    $candidate->{settings} //= {};
    $candidate->{settings}{layoutMode} = 'grid';
    $candidate->{settings}{gridColumns} = 12;
    $candidate->{navigation} //= {orientation => 'horizontal'};
    $candidate->{navigation}{grid} = {%{$positions->{navigation}}};

    for my $page (@{$candidate->{pages}}) {
        my $plan = $pages{$page->{id}};
        return (undef, 'Seite im Migrationsplan fehlt')
            if (!$plan || @{$plan->{widgets}} != @{$page->{widgets}});
        my %widgets;
        for my $widget (@{$plan->{widgets}}) {
            return (undef, 'Ungueltiges Widget im Migrationsplan')
                if (ref($widget) ne 'HASH' || keys(%{$widget}) != 2
                    || !defined($widget->{id}) || ref($widget->{id})
                    || $widget->{id} !~ /\A[A-Za-z0-9_-]{1,64}\z/
                    || $widgets{$widget->{id}} || !$checkGrid->($widget->{grid}));
            $widgets{$widget->{id}} = $widget->{grid};
        }
        my @grids = ($candidate->{navigation}{grid});
        for my $widget (@{$page->{widgets}}) {
            return (undef, 'Widget-ID __nav ist fuer die Navigation reserviert')
                if ($widget->{id} eq '__nav');
            return (undef, 'Widget im Migrationsplan fehlt') if (!$widgets{$widget->{id}});
            my $grid = $widgets{$widget->{id}};
            for my $other (@grids) {
                return (undef, 'Ueberschneidung im Migrationsplan')
                    if ($grid->{col} < $other->{col} + $other->{w}
                        && $other->{col} < $grid->{col} + $grid->{w}
                        && $grid->{row} < $other->{row} + $other->{h}
                        && $other->{row} < $grid->{row} + $grid->{h});
            }
            $widget->{grid} = {%{$grid}};
            push(@grids, $widget->{grid});
        }
    }
    return (undef, 'Konfiguration ist zu gross')
        if (length(JSON::PP->new->utf8->canonical->pretty->encode($candidate)) > $FHEMCMS_MAX_CONFIG_BYTES);
    $error = FHEMCMS_ValidateConfig($candidate, 5);
    return (undef, "Zielkonfiguration ist ungueltig: $error") if (defined($error));
    return ($candidate, undef);
}

# Nur Vorschau: Ein spaeterer Schreibpfad muss denselben Zustand erneut pruefen.
sub FHEMCMS_PreviewLayoutMigration {
    my ($dataDir, $positions) = @_;
    my $draft = File::Spec->catfile($dataDir, 'draft.json');
    return (undef, undef, 'Entwurf vorhanden: zuerst veroeffentlichen oder verwerfen') if (-e $draft || -l $draft);
    my $live = File::Spec->catfile($dataDir, 'config.json');
    return (undef, undef, 'Live-Konfiguration darf kein Symlink sein') if (-l $live);
    my ($bytes, $error) = FHEMCMS_ReadFile($live);
    return (undef, undef, $error) if (defined($error));
    my ($source, $parseError) = FHEMCMS_ParseConfig($bytes);
    return (undef, undef, "Live-Konfiguration ist ungueltig: $parseError") if (defined($parseError));
    my ($candidate, $planError) = FHEMCMS_PrepareLayoutMigration($source, $positions);
    return (undef, undef, $planError) if (defined($planError));
    my $target = JSON::PP->new->utf8->canonical->encode($candidate);
    my $token = sha256_hex(length($bytes) . ':' . $bytes . length($target) . ':' . $target);
    return ($candidate, $token, undef, $source);
}

# Der versionierte Vertrag bleibt intern, bis die passende Runtime nutzbar ist.
sub FHEMCMS_ReadVersion5State {
    my ($dataDir) = @_;
    my $json = JSON::PP->new->utf8->canonical;
    my @entries;
    for my $file ('config.json', 'draft.json') {
        my $path = File::Spec->catfile($dataDir, $file);
        return (undef, "Symlink fuer $file ist nicht erlaubt") if (-l $path);
        if ($file eq 'draft.json' && !-e $path) {
            push(@entries, undef);
            next;
        }
        my ($bytes, $readError) = FHEMCMS_ReadFile($path);
        return (undef, "$file: $readError") if (defined($readError));
        my $config = eval { $json->decode($bytes) };
        return (undef, "$file: ungueltiges JSON") if ($@ || !defined($config));
        my $error = FHEMCMS_ValidateConfig($config, 5);
        return (undef, "$file: $error") if (defined($error));
        push(@entries, {bytes => $bytes, config => $config});
    }
    my ($live, $draft) = @entries;
    my $token = sha256_hex(length($live->{bytes}) . ':' . $live->{bytes}
        . (defined($draft) ? '1:' . length($draft->{bytes}) . ':' . $draft->{bytes} : '0:'));
    return ({live => $live->{config}, draft => defined($draft) ? $draft->{config} : undef, token => $token}, undef);
}

sub FHEMCMS_WriteVersion5Draft {
    my ($dataDir, $config, $expectedToken) = @_;
    return 'Ungueltige Zustandskennung'
        if (!defined($expectedToken) || ref($expectedToken) || $expectedToken !~ /\A[0-9a-f]{64}\z/);
    my $error = FHEMCMS_ValidateConfig($config, 5);
    return "Entwurf ist ungueltig: $error" if (defined($error));
    my $encoded = JSON::PP->new->utf8->canonical->pretty->encode($config);
    return 'Konfiguration ist zu gross' if (length($encoded) > $FHEMCMS_MAX_CONFIG_BYTES);
    my ($state, $stateError) = FHEMCMS_ReadVersion5State($dataDir);
    return $stateError if (defined($stateError));
    return 'Zustand ist veraltet; bitte erneut laden' if ($state->{token} ne $expectedToken);

    my $tmp = File::Spec->catfile($dataDir, 'draft.json.v5.tmp');
    my $out;
    return "Temporaerer Entwurf konnte nicht angelegt werden: $!"
        if (!sysopen($out, $tmp, O_WRONLY | O_CREAT | O_EXCL, 0640));
    binmode($out, ':raw');
    my $written = print {$out} $encoded;
    my $synced = $written && $out->sync();
    my $closed = close($out);
    if (!$written || !$synced || !$closed) {
        my $reason = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaerer Entwurf konnte nicht entfernt werden: $!");
        return "Entwurf konnte nicht geschrieben werden: $reason";
    }
    ($state, $stateError) = FHEMCMS_ReadVersion5State($dataDir);
    if (defined($stateError) || $state->{token} ne $expectedToken) {
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaerer Entwurf konnte nicht entfernt werden: $!");
        return defined($stateError) ? $stateError : 'Zustand ist veraltet; bitte erneut laden';
    }
    if (!rename($tmp, File::Spec->catfile($dataDir, 'draft.json'))) {
        my $reason = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaerer Entwurf konnte nicht entfernt werden: $!");
        return "Entwurf konnte nicht gespeichert werden: $reason";
    }
    return undef;
}

sub FHEMCMS_DiscardVersion5Draft {
    my ($dataDir, $expectedToken) = @_;
    return 'Ungueltige Zustandskennung'
        if (!defined($expectedToken) || ref($expectedToken) || $expectedToken !~ /\A[0-9a-f]{64}\z/);
    my ($state, $error) = FHEMCMS_ReadVersion5State($dataDir);
    return $error if (defined($error));
    return 'Zustand ist veraltet; bitte erneut laden' if ($state->{token} ne $expectedToken);
    return 'Es gibt keinen Entwurf zum Verwerfen' if (!defined($state->{draft}));
    return "Entwurf konnte nicht geloescht werden: $!"
        if (!unlink(File::Spec->catfile($dataDir, 'draft.json')));
    return undef;
}

sub FHEMCMS_PublishVersion5Draft {
    my ($dataDir, $expectedToken) = @_;
    return (undef, 'Ungueltige Zustandskennung')
        if (!defined($expectedToken) || ref($expectedToken) || $expectedToken !~ /\A[0-9a-f]{64}\z/);
    my ($state, $error) = FHEMCMS_ReadVersion5State($dataDir);
    return (undef, $error) if (defined($error));
    return (undef, 'Zustand ist veraltet; bitte erneut laden') if ($state->{token} ne $expectedToken);
    return (undef, 'Es gibt keinen Entwurf zum Veroeffentlichen') if (!defined($state->{draft}));
    my $livePath = File::Spec->catfile($dataDir, 'config.json');
    my $draftPath = File::Spec->catfile($dataDir, 'draft.json');
    my ($live, $liveError) = FHEMCMS_ReadFile($livePath);
    return (undef, $liveError) if (defined($liveError));
    my ($draft, $draftError) = FHEMCMS_ReadFile($draftPath);
    return (undef, $draftError) if (defined($draftError));
    my $readToken = sha256_hex(length($live) . ':' . $live . '1:' . length($draft) . ':' . $draft);
    return (undef, 'Zustand ist veraltet; bitte erneut laden') if ($readToken ne $expectedToken);
    my $tmp = File::Spec->catfile($dataDir, 'config.json.v5.tmp');
    my $out;
    return (undef, "Temporaere Datei konnte nicht angelegt werden: $!")
        if (!sysopen($out, $tmp, O_WRONLY | O_CREAT | O_EXCL, 0640));
    binmode($out, ':raw');
    my $written = print {$out} $draft;
    my $synced = $written && $out->sync();
    my $closed = close($out);
    if (!$written || !$synced || !$closed) {
        my $reason = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Datei konnte nicht entfernt werden: $!");
        return (undef, "Veroeffentlichung konnte nicht vorbereitet werden: $reason");
    }
    my ($backup, $backupError) = FHEMCMS_CreateMigrationBackup($dataDir, $live);
    if (defined($backupError)) {
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Datei konnte nicht entfernt werden: $!");
        return (undef, $backupError);
    }
    ($state, $error) = FHEMCMS_ReadVersion5State($dataDir);
    if (defined($error) || $state->{token} ne $expectedToken) {
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Datei konnte nicht entfernt werden: $!");
        return (undef, defined($error) ? $error : 'Zustand ist veraltet; bitte erneut laden');
    }
    if (!rename($tmp, $livePath)) {
        my $reason = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Datei konnte nicht entfernt werden: $!");
        return (undef, "Veroeffentlichung konnte nicht gespeichert werden: $reason");
    }
    return ($backup, "Live gespeichert, Entwurf konnte nicht geloescht werden: $!") if (!unlink($draftPath));
    return ($backup, undef);
}

# Interner Transaktionsbaustein; bewusst nicht als FHEM-Befehl registriert.
sub FHEMCMS_CommitLayoutMigration {
    my ($dataDir, $positions, $expectedToken) = @_;
    return (undef, 'Ungueltige Vorschau-Bestaetigung')
        if (!defined($expectedToken) || ref($expectedToken) || $expectedToken !~ /\A[0-9a-f]{64}\z/);
    my ($candidate, $token, $error) = FHEMCMS_PreviewLayoutMigration($dataDir, $positions);
    return (undef, $error) if (defined($error));
    return (undef, 'Vorschau ist veraltet; bitte erneut pruefen')
        if ($token ne $expectedToken);

    my $live = File::Spec->catfile($dataDir, 'config.json');
    my ($original, $readError) = FHEMCMS_ReadFile($live);
    return (undef, $readError) if (defined($readError));
    my $target = JSON::PP->new->utf8->canonical->encode($candidate);
    return (undef, 'Vorschau ist veraltet; bitte erneut pruefen')
        if (sha256_hex(length($original) . ':' . $original . length($target) . ':' . $target) ne $expectedToken);
    my $encoded = JSON::PP->new->utf8->canonical->pretty->encode($candidate);
    return (undef, 'Konfiguration ist zu gross') if (length($encoded) > $FHEMCMS_MAX_CONFIG_BYTES);
    return FHEMCMS_ReplaceMigrationLive($dataDir, $original, $encoded);
}

# Atomarer Austausch nur nach verifiziertem Backup und erneuter Zustandspruefung.
sub FHEMCMS_ReplaceMigrationLive {
    my ($dataDir, $original, $encoded) = @_;
    my $live = File::Spec->catfile($dataDir, 'config.json');
    my $draft = File::Spec->catfile($dataDir, 'draft.json');
    return (undef, 'Entwurf vorhanden: zuerst veroeffentlichen oder verwerfen') if (-e $draft || -l $draft);
    return (undef, 'Live-Konfiguration darf kein Symlink sein') if (-l $live);
    my ($current, $currentError) = FHEMCMS_ReadFile($live);
    return (undef, $currentError) if (defined($currentError));
    return (undef, 'Vorschau ist veraltet; bitte erneut pruefen') if ($current ne $original);
    my $tmp = File::Spec->catfile($dataDir, 'config.json.migration.tmp');
    my $out;
    return (undef, "Temporaere Migrationsdatei konnte nicht angelegt werden: $!")
        if (!sysopen($out, $tmp, O_WRONLY | O_CREAT | O_EXCL, 0640));
    binmode($out, ':raw');
    my $written = print {$out} $encoded;
    my $synced = $written && $out->sync();
    my $closed = close($out);
    if (!$written || !$synced || !$closed) {
        my $reason = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Migrationsdatei konnte nicht entfernt werden: $!");
        return (undef, "Migrationsdatei konnte nicht geschrieben werden: $reason");
    }

    my ($backup, $backupError) = FHEMCMS_CreateMigrationBackup($dataDir, $original);
    if (defined($backupError)) {
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Migrationsdatei konnte nicht entfernt werden: $!");
        return (undef, $backupError);
    }
    my $checkError;
    if (-e $draft || -l $draft) {
        $checkError = 'Entwurf vorhanden: zuerst veroeffentlichen oder verwerfen';
    } elsif (-l $live) {
        $checkError = 'Live-Konfiguration darf kein Symlink sein';
    } else {
        my ($check, $error) = FHEMCMS_ReadFile($live);
        $checkError = defined($error) ? $error
            : $check ne $original ? 'Vorschau ist veraltet; bitte erneut pruefen' : undef;
    }
    if (defined($checkError)) {
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Migrationsdatei konnte nicht entfernt werden: $!");
        return (undef, $checkError);
    }
    if (!rename($tmp, $live)) {
        my $reason = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, "FHEMCMS: temporaere Migrationsdatei konnte nicht entfernt werden: $!");
        return (undef, "Migration konnte nicht gespeichert werden: $reason");
    }
    return ($backup, undef);
}

# Wiederherstellung ist nur intern vorbereitet, bis die versionierte UI existiert.
sub FHEMCMS_PreviewMigrationRestore {
    my ($dataDir, $backupName) = @_;
    return (undef, undef, 'Ungueltiger Backup-Name')
        if (!defined($backupName) || ref($backupName)
            || $backupName !~ /\Aconfig\.json\.\d{8}-\d{6}(?:-\d+)?\.bak\z/);
    my $draft = File::Spec->catfile($dataDir, 'draft.json');
    return (undef, undef, 'Entwurf vorhanden: zuerst veroeffentlichen oder verwerfen') if (-e $draft || -l $draft);
    my $live = File::Spec->catfile($dataDir, 'config.json');
    my $backup = File::Spec->catfile($dataDir, $backupName);
    return (undef, undef, 'Symlinks sind fuer Restore nicht erlaubt') if (-l $live || -l $backup);
    my ($liveBytes, $liveError) = FHEMCMS_ReadFile($live);
    return (undef, undef, $liveError) if (defined($liveError));
    my ($backupBytes, $backupError) = FHEMCMS_ReadFile($backup);
    return (undef, undef, $backupError) if (defined($backupError));
    for my $entry ([$liveBytes, 'Live-Konfiguration'], [$backupBytes, 'Backup']) {
        my ($bytes, $label) = @{$entry};
        my $config = eval { JSON::PP->new->utf8->decode($bytes) };
        return (undef, undef, "$label ist kein gueltiges JSON") if ($@ || ref($config) ne 'HASH');
        my $error;
        if (defined($config->{schemaVersion}) && !ref($config->{schemaVersion})
            && $config->{schemaVersion} =~ /\A[0-9]{1,6}\z/ && $config->{schemaVersion} == 5) {
            $error = FHEMCMS_ValidateConfig($config, 5);
        } else {
            (undef, $error) = FHEMCMS_ParseConfig($bytes);
        }
        return (undef, undef, "$label ist ungueltig: $error") if (defined($error));
    }
    my $token = sha256_hex(length($liveBytes) . ':' . $liveBytes . length($backupBytes) . ':' . $backupBytes);
    return ($backupBytes, $token, undef);
}

sub FHEMCMS_CommitMigrationRestore {
    my ($dataDir, $backupName, $expectedToken) = @_;
    return (undef, 'Ungueltige Vorschau-Bestaetigung')
        if (!defined($expectedToken) || ref($expectedToken) || $expectedToken !~ /\A[0-9a-f]{64}\z/);
    my ($backupBytes, $token, $error) = FHEMCMS_PreviewMigrationRestore($dataDir, $backupName);
    return (undef, $error) if (defined($error));
    return (undef, 'Vorschau ist veraltet; bitte erneut pruefen') if ($token ne $expectedToken);
    my ($liveBytes, $readError) = FHEMCMS_ReadFile(File::Spec->catfile($dataDir, 'config.json'));
    return (undef, $readError) if (defined($readError));
    return (undef, 'Vorschau ist veraltet; bitte erneut pruefen')
        if (sha256_hex(length($liveBytes) . ':' . $liveBytes . length($backupBytes) . ':' . $backupBytes) ne $expectedToken);
    return FHEMCMS_ReplaceMigrationLive($dataDir, $liveBytes, $backupBytes);
}

sub FHEMCMS_CreateMigrationBackup {
    my ($dataDir, $bytes) = @_;
    my $stamp = strftime('%Y%m%d-%H%M%S', localtime());
    my ($name, $path, $out);
    my $created = 0;
    for (my $i = 0; $i <= 10000; $i++) {
        $name = 'config.json.' . $stamp . ($i ? "-$i" : '') . '.bak';
        $path = File::Spec->catfile($dataDir, $name);
        if (sysopen($out, $path, O_WRONLY | O_CREAT | O_EXCL, 0640)) {
            $created = 1;
            last;
        }
        return (undef, "Migrationsbackup konnte nicht angelegt werden: $!") if (!$!{EEXIST});
    }
    return (undef, 'Kein freier Name fuer Migrationsbackup') if (!$created);
    binmode($out, ':raw');
    my $written = print {$out} $bytes;
    my $synced = $written && $out->sync();
    my $closed = close($out);
    if (!$written || !$synced || !$closed) {
        my $reason = "$!";
        unlink($path) or Log3('FHEMCMS', 1, "FHEMCMS: unvollstaendiges Migrationsbackup konnte nicht entfernt werden: $!");
        return (undef, "Migrationsbackup konnte nicht geschrieben werden: $reason");
    }
    my ($verify, $error) = FHEMCMS_ReadFile($path);
    if (defined($error) || $verify ne $bytes) {
        unlink($path) or Log3('FHEMCMS', 1, "FHEMCMS: ungueltiges Migrationsbackup konnte nicht entfernt werden: $!");
        return (undef, defined($error) ? "Migrationsbackup nicht lesbar: $error" : 'Migrationsbackup stimmt nicht ueberein');
    }
    return ($name, undef);
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
