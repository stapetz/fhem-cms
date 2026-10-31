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

    if ($cmd eq 'config' || $cmd eq 'backups') {
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my ($error, $dataDir) = FHEMCMS_CreateDataDir($name);
        return $error if (defined($error));

        if ($cmd eq 'backups') {
            return JSON::PP->new->utf8->canonical->encode([FHEMCMS_ListBackups($dataDir)]);
        }
        my ($text, $readError) = FHEMCMS_ReadFile(File::Spec->catfile($dataDir, 'config.json'));
        return $readError if (defined($readError));
        my ($config, $parseError) = FHEMCMS_ParseConfig($text);
        return "Konfiguration ist ungueltig: $parseError" if (defined($parseError));
        return JSON::PP->new->utf8->canonical->encode($config);
    }

    return 'Unknown argument ' . $cmd . ', choose one of url:noArg config:noArg backups:noArg';
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

    if ($cmd eq 'config' || $cmd eq 'restore') {
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
        return FHEMCMS_WriteConfig($name, $dataDir, $config);
    }

    if ($cmd eq 'rebuild') {
        return 'rebuild erwartet keine Parameter' if (@args);
        return 'Ungueltiges Device' if (!FHEMCMS_ValidName($name));
        my $error = FHEMCMS_CreateStartPage($name);
        return $error if (defined($error));
        $FHEMCMS_LAST_REFRESH{$name} = time();
        return undef;
    }

    return 'Unknown argument ' . $cmd . ', choose one of config restore rebuild:noArg purge';
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
    return '<a href="' . $basePath . '/fhem-cms/' . $name . '/index.html">CMS starten</a>';
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
        my @foreign = grep { $_ ne 'index.html' && $_ !~ /\Aindex\.html\..*\.tmp\z/ } @entries;
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
    <p class="cms-kicker">FHEM CMS | Testoberflaeche</p>
    <h1>fhem-cms</h1>
    <p class="cms-copy">Der Frontend-Einstiegspunkt wurde fuer dieses FHEM-Device angelegt.</p>
    <cms-device-card device="$htmlName" status="Frontend wird geladen ..."></cms-device-card>
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

    my $err = $exact->($config, 'Konfiguration', ['schemaVersion', 'pages']);
    return $err if ($err);
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
                $err = $exact->($widget, 'Widget', ['id', 'type', 'markdown', 'grid'], ['title']);
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

            if ($widget->{type} eq 'text') {
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

            $err = $exact->($widget->{grid}, 'grid', ['col', 'row', 'w', 'h']);
            return $err if ($err);
            my $grid = $widget->{grid};
            return 'Ungueltige Rasterwerte'
                if (!$isInt->($grid->{col}, 1, 12) || !$isInt->($grid->{row}, 1, 1000)
                    || !$isInt->($grid->{w}, 1, 12) || !$isInt->($grid->{h}, 1, 1000)
                    || $grid->{col} + $grid->{w} > 13);
        }
    }
    return undef;
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
    my ($name, $dataDir, $config) = @_;
    my $error = FHEMCMS_ValidateConfig($config);
    return $error if (defined($error));

    my $text = JSON::PP->new->utf8->canonical->pretty->encode($config);
    return 'Konfiguration ist zu gross' if (length($text) > $FHEMCMS_MAX_CONFIG_BYTES);

    my $file = File::Spec->catfile($dataDir, 'config.json');
    my $tmp = File::Spec->catfile($dataDir, 'config.json.tmp');
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

    if (-e $file) {
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
