package main;

use strict;
use warnings;
use Cwd qw(abs_path);
use Digest::SHA qw(sha256_hex);
use File::Spec;
use JSON::PP ();
use MIME::Base64 qw(decode_base64 encode_base64);

our (%defs, %attr);
our $FHEMCMS_LOG_INDEX_JOB;
our $FHEMCMS_LOG_INDEX_ERROR;
our $FHEMCMS_LOG_INDEX_JOB_TIMEOUT = 1800;
our $FHEMCMS_LOG_INDEX_SEQUENCE = 0;
our $FHEMCMS_LOG_INDEX_TIMER = 'FHEMCMS_LogIndexTimer';

sub FHEMCMS_LogIndexSchedule {
    return if (!defined(&InternalTimer) || !defined(&RemoveInternalTimer));
    RemoveInternalTimer($FHEMCMS_LOG_INDEX_TIMER, 'FHEMCMS_LogIndexTimer');
    InternalTimer(FHEMCMS_LogIndexNextBuild(time()), 'FHEMCMS_LogIndexTimer',
        $FHEMCMS_LOG_INDEX_TIMER, 0);
    return;
}

sub FHEMCMS_LogIndexTimer {
    FHEMCMS_LogIndexSchedule();
    my $error = FHEMCMS_LogIndexStart();
    Log3('FHEMCMS', 2, "FHEMCMS: $error") if (defined($error) && $error ne 'Cache-Aufbau laeuft bereits');
    return;
}

sub FHEMCMS_LogIndexRoot {
    my $modpath = $attr{global}{modpath};
    return (undef, 'FHEM modpath ist ungueltig') if (!defined($modpath) || ref($modpath) || $modpath eq '');
    my $root = abs_path($modpath);
    return (undef, 'FHEM modpath ist ungueltig') if (!defined($root) || !-d $root);
    my $dir = File::Spec->catdir($root, 'fhem-cms-data');
    return (undef, 'Cache-Datenverzeichnis ist ungueltig')
        if (-l $dir || !-d $dir || !FHEMCMS_IsChildPath(abs_path($dir), $root));
    return ($dir, undef);
}

sub FHEMCMS_LogIndexFingerprint {
    my @sources;
    for my $name (sort keys %defs) {
        my $log = $defs{$name};
        next if (ref($log) ne 'HASH' || ($log->{TYPE} // '') !~ /\A(?:DbLog|FileLog)\z/);
        return undef if (!FHEMCMS_ValidName($name));
        my $attributes = $attr{$name} // {};
        return undef if (ref($attributes) ne 'HASH');
        push(@sources, {name => $name, type => $log->{TYPE}, logfile => $log->{logfile} // '',
            regexp => $log->{REGEXP} // '', dbconn => $log->{dbconn} // '',
            table => ref($log->{HELPER}) eq 'HASH' ? ($log->{HELPER}{TH} // '') : '',
            archivedir => $attributes->{archivedir} // '', archivecmd => $attributes->{archivecmd} // '',
            outputFormat => $attributes->{outputFormat} // ''});
    }
    return sha256_hex(JSON::PP->new->utf8->canonical->encode({
        sources => \@sources, logdir => $attr{global}{logdir} // './log',
    }));
}

sub FHEMCMS_LogIndexReadings {
    my ($cms, $device, $source) = @_;
    return 'Ungueltige Cache-Abfrage' if (!FHEMCMS_ValidName($cms)
        || !FHEMCMS_ValidName($device) || ($source // '') !~ /\A(?:auto|dblog|filelog)\z/);
    my ($dir, $rootError) = FHEMCMS_LogIndexRoot();
    return $rootError if (defined($rootError));
    my ($cache, $error) = FHEMCMS_LogIndexRead($dir);
    return $error if (defined($error));
    my $mode = $source eq 'auto' ? ($attr{$cms}{historySource} // 'auto') : $source;
    return 'Ungueltige History-Quelle' if ($mode !~ /\A(?:auto|dblog|filelog)\z/);
    my @db = $mode ne 'filelog' ? FHEMCMS_LogDevices($cms, 'DbLog', 'dbLog') : ();
    my @file = $mode ne 'dblog' ? FHEMCMS_LogDevices($cms, 'FileLog', 'fileLog') : ();
    return 'Kein DbLog- oder FileLog-Device gefunden' if (!@db && !@file);
    my (%readings, @warnings, @used);
    for my $item (['dblog', @db ? ($db[0]) : ()], ['filelog', @file]) {
        my ($kind, @logs) = @{$item};
        next if (!@logs);
        my ($names, $selectionError, $sourceWarnings) = FHEMCMS_LogIndexSelect(
            $cache, $kind, [map { $_->{NAME} } @logs], $device);
        return $selectionError if (defined($selectionError));
        $readings{$_} = 1 for @{$names};
        push(@warnings, @{$sourceWarnings});
        push(@used, $kind) if (@{$names});
    }
    push(@warnings, 'Logquellen-Konfiguration wurde geaendert; Cache moeglicherweise veraltet')
        if (($cache->{fingerprint} // '') ne (FHEMCMS_LogIndexFingerprint() // ''));
    push(@warnings, "Letzter Cache-Aufbau fehlgeschlagen: $FHEMCMS_LOG_INDEX_ERROR")
        if (defined($FHEMCMS_LOG_INDEX_ERROR));
    return JSON::PP->new->utf8->canonical->encode({
        source => @used > 1 ? 'mixed' : @used ? $used[0] : @db ? 'dblog' : 'filelog',
        readings => [sort keys %readings],
        warnings => \@warnings,
    });
}

sub FHEMCMS_LogIndexDevices {
    my ($cms, $source, $allowed) = @_;
    return 'Ungueltige Cache-Abfrage' if (!FHEMCMS_ValidName($cms)
        || ($source // '') !~ /\A(?:auto|dblog|filelog)\z/ || ref($allowed) ne 'ARRAY'
        || grep { !FHEMCMS_ValidName($_) } @{$allowed});
    my %allowed = map { $_ => 1 } @{$allowed};
    my ($dir, $rootError) = FHEMCMS_LogIndexRoot();
    return $rootError if (defined($rootError));
    my ($cache, $error) = FHEMCMS_LogIndexRead($dir);
    return $error if (defined($error));
    my $mode = $source eq 'auto' ? ($attr{$cms}{historySource} // 'auto') : $source;
    return 'Ungueltige History-Quelle' if ($mode !~ /\A(?:auto|dblog|filelog)\z/);
    my @db = $mode ne 'filelog' ? FHEMCMS_LogDevices($cms, 'DbLog', 'dbLog') : ();
    my @file = $mode ne 'dblog' ? FHEMCMS_LogDevices($cms, 'FileLog', 'fileLog') : ();
    return 'Kein DbLog- oder FileLog-Device gefunden' if (!@db && !@file);
    my (%devices, @warnings);
    for my $item (['dblog', @db ? ($db[0]) : ()], ['filelog', @file]) {
        my ($kind, @logs) = @{$item};
        for my $log (@logs) {
            my $name = $log->{NAME};
            my $sourceData = $cache->{sources}{$kind}{$name};
            my $sourceError = $cache->{errors}{$kind}{$name};
            if (defined($sourceError)) {
                push(@warnings, "Logquelle $name: $sourceError; Cache moeglicherweise veraltet");
                next if (!defined($sourceData));
            }
            return "Logquelle $name fehlt im Cache" if (ref($sourceData) ne 'HASH');
            $devices{$_} = 1 for grep { $allowed{$_} && keys %{$sourceData->{$_}} } keys %{$sourceData};
        }
    }
    push(@warnings, 'Logquellen-Konfiguration wurde geaendert; Cache moeglicherweise veraltet')
        if (($cache->{fingerprint} // '') ne (FHEMCMS_LogIndexFingerprint() // ''));
    push(@warnings, "Letzter Cache-Aufbau fehlgeschlagen: $FHEMCMS_LOG_INDEX_ERROR")
        if (defined($FHEMCMS_LOG_INDEX_ERROR));
    return JSON::PP->new->utf8->canonical->encode({devices => [sort keys %devices], warnings => \@warnings});
}

sub FHEMCMS_LogIndexContents {
    my ($allowed, $offset) = @_;
    return 'Ungueltige Cache-Abfrage' if (ref($allowed) ne 'ARRAY'
        || grep { !FHEMCMS_ValidName($_) } @{$allowed});
    return 'Ungueltige Cache-Seite' if (!defined($offset) || ref($offset)
        || $offset !~ /\A\d{1,5}\z/ || $offset > 20000);
    my %allowed = map { $_ => 1 } @{$allowed};
    my ($dir, $rootError) = FHEMCMS_LogIndexRoot();
    return $rootError if (defined($rootError));
    my ($cache, $error) = FHEMCMS_LogIndexRead($dir);
    return $error if (defined($error));
    my (%devices, @warnings);
    for my $kind (qw(dblog filelog)) {
        for my $name (sort keys %{$cache->{sources}{$kind}}) {
            my $source = $cache->{sources}{$kind}{$name};
            for my $device (keys %{$source}) {
                next if (!$allowed{$device});
                for my $reading (keys %{$source->{$device}}) {
                    $devices{$device}{$reading}{$kind}{$allowed{$name} ? $name : ''} = 1;
                }
            }
        }
        for my $name (sort keys %{$cache->{errors}{$kind} // {}}) {
            push(@warnings, $allowed{$name}
                ? "Logquelle $name: $cache->{errors}{$kind}{$name}; Cache moeglicherweise veraltet"
                : 'Eine Logquelle konnte nicht aktualisiert werden; Cache moeglicherweise veraltet');
        }
    }
    push(@warnings, 'Logquellen-Konfiguration wurde geaendert; Cache moeglicherweise veraltet')
        if (($cache->{fingerprint} // '') ne (FHEMCMS_LogIndexFingerprint() // ''));
    my @names = sort keys %devices;
    my @page = $offset < @names ? splice(@names, $offset, 50) : ();
    my $json = JSON::PP->new->utf8->canonical->encode({
        items => [map {
            my $device = $_;
            {name => $device, readings => [map {
                my $reading = $_;
                {name => $reading, sources => [map {
                    my $kind = $_;
                    map { {type => $kind, ($_ ne '' ? (name => $_) : ())} }
                        sort keys %{$devices{$device}{$reading}{$kind}};
                } sort keys %{$devices{$device}{$reading}}]};
            } sort keys %{$devices{$device}}]};
        } @page],
        total => scalar(keys %devices), offset => 0 + $offset, warnings => \@warnings,
    });
    return length($json) <= 262144 ? $json : 'Cache-Seite ist zu gross zur Anzeige';
}

sub FHEMCMS_LogIndexStart {
    return 'Cache-Aufbau laeuft bereits' if ($FHEMCMS_LOG_INDEX_JOB);
    return 'Asynchroner Cache-Aufbau ist nicht verfuegbar' if (!defined(&BlockingCall));
    my ($dir, $error) = FHEMCMS_LogIndexRoot();
    return $error if (defined($error));
    my $fingerprint = FHEMCMS_LogIndexFingerprint();
    return 'Ungueltige Logquellen-Konfiguration' if (!defined($fingerprint));
    my $token = sha256_hex(join("\0", $$, ++$FHEMCMS_LOG_INDEX_SEQUENCE, Time::HiRes::time(), $fingerprint));
    my $request = {token => $token, fingerprint => $fingerprint};
    my $arg = encode_base64(JSON::PP->new->utf8->canonical->encode($request), '');
    $FHEMCMS_LOG_INDEX_JOB = $request;
    my $started = eval {
        BlockingCall('FHEMCMS_LogIndexWorker', $arg, 'FHEMCMS_LogIndexDone',
            $FHEMCMS_LOG_INDEX_JOB_TIMEOUT, 'FHEMCMS_LogIndexAbort', $arg);
    };
    if ($@ || ref($started) ne 'HASH' || !defined($started->{pid}) || $started->{pid} !~ /\A-?\d+\z/) {
        undef($FHEMCMS_LOG_INDEX_JOB);
        $FHEMCMS_LOG_INDEX_ERROR = 'Cache-Aufbau konnte nicht gestartet werden';
        Log3('FHEMCMS', 2, "FHEMCMS: $FHEMCMS_LOG_INDEX_ERROR");
        return $FHEMCMS_LOG_INDEX_ERROR;
    }
    return undef;
}

sub FHEMCMS_LogIndexWorker {
    my ($arg) = @_;
    my $request = eval { JSON::PP->new->utf8->decode(decode_base64($arg // '')) };
    return '' if ($@ || ref($request) ne 'HASH' || ($request->{token} // '') !~ /\A[0-9a-f]{64}\z/
        || ($request->{fingerprint} // '') !~ /\A[0-9a-f]{64}\z/);
    my ($dir, $error) = FHEMCMS_LogIndexRoot();
    my $cache;
    if (!defined($error)) {
        my @logs = grep { ref($_) eq 'HASH' && ($_->{TYPE} // '') =~ /\A(?:DbLog|FileLog)\z/ }
            map { $defs{$_} } sort keys %defs;
        my $ok = eval {
            my $oldFile = File::Spec->catfile($dir, 'log-index.json');
            my $previous;
            if (-e $oldFile || -l $oldFile) {
                ($previous, $error) = FHEMCMS_LogIndexRead($dir);
                $error = "Vorheriger Cache ungueltig: $error" if (defined($error));
            }
            if (!defined($error)) {
                ($cache, $error) = FHEMCMS_LogIndexBuild(\@logs, \%attr,
                    $attr{global}{logdir} // './log', CORE::time(), $previous);
            }
            if (!defined($error)) {
                $cache->{fingerprint} = $request->{fingerprint};
                $error = FHEMCMS_LogIndexWrite($dir, $cache, ".log-index-$request->{token}.json");
            }
            1;
        };
        $error = 'Cache-Aufbau ist fehlgeschlagen' if (!$ok);
    }
    return encode_base64(JSON::PP->new->utf8->canonical->encode({
        token => $request->{token}, error => $error,
        sourceErrors => defined($cache) ? scalar(keys %{$cache->{errors}{dblog}})
            + scalar(keys %{$cache->{errors}{filelog}}) : 0,
    }), '');
}

sub FHEMCMS_LogIndexDiscardCandidate {
    my ($token) = @_;
    return if (($token // '') !~ /\A[0-9a-f]{64}\z/);
    my ($dir, $error) = FHEMCMS_LogIndexRoot();
    return if (defined($error));
    my $candidate = File::Spec->catfile($dir, ".log-index-$token.json");
    if ((-e $candidate || -l $candidate) && !unlink($candidate)) {
        Log3('FHEMCMS', 1, 'FHEMCMS: temporaerer Cache konnte nicht entfernt werden');
    }
}

sub FHEMCMS_LogIndexDone {
    my ($result) = @_;
    my $payload = eval { JSON::PP->new->utf8->decode(decode_base64($result // '')) };
    return if (!$FHEMCMS_LOG_INDEX_JOB);
    if ($@ || ref($payload) ne 'HASH' || ($payload->{token} // '') !~ /\A[0-9a-f]{64}\z/) {
        my $token = $FHEMCMS_LOG_INDEX_JOB->{token};
        undef($FHEMCMS_LOG_INDEX_JOB);
        FHEMCMS_LogIndexDiscardCandidate($token);
        $FHEMCMS_LOG_INDEX_ERROR = 'Cache-Aufbau lieferte eine ungueltige Antwort';
        Log3('FHEMCMS', 2, "FHEMCMS: $FHEMCMS_LOG_INDEX_ERROR");
        return;
    }
    return if ($FHEMCMS_LOG_INDEX_JOB->{token} ne $payload->{token});
    my $job = $FHEMCMS_LOG_INDEX_JOB;
    undef($FHEMCMS_LOG_INDEX_JOB);
    my $error = $payload->{error};
    $error = 'Cache-Aufbau lieferte eine ungueltige Antwort' if (defined($error) && ref($error));
    $error = 'Cache-Aufbau lieferte eine ungueltige Antwort'
        if (ref($payload->{sourceErrors}) || ($payload->{sourceErrors} // '') !~ /\A\d+\z/);
    $error = 'Logquellen wurden waehrend des Cache-Aufbaus geaendert'
        if (!defined($error) && (FHEMCMS_LogIndexFingerprint() // '') ne $job->{fingerprint});
    my ($dir, $rootError) = FHEMCMS_LogIndexRoot();
    $error //= $rootError;
    if (!defined($error)) {
        my $candidate = File::Spec->catfile($dir, ".log-index-$payload->{token}.json");
        my $target = File::Spec->catfile($dir, 'log-index.json');
        $error = 'Cache konnte nicht veroeffentlicht werden'
            if (-l $candidate || !-f $candidate || -l $target || !rename($candidate, $target));
    }
    FHEMCMS_LogIndexDiscardCandidate($payload->{token});
    $FHEMCMS_LOG_INDEX_ERROR = $error // ($payload->{sourceErrors}
        ? "$payload->{sourceErrors} Logquellen konnten nicht aktualisiert werden" : undef);
    %main::FHEMCMS_HISTORY_CACHE = () if (!defined($error));
    Log3('FHEMCMS', defined($FHEMCMS_LOG_INDEX_ERROR) ? 2 : 3,
        defined($FHEMCMS_LOG_INDEX_ERROR) ? "FHEMCMS: $FHEMCMS_LOG_INDEX_ERROR"
            : 'FHEMCMS: Log-Cache aufgebaut');
    return;
}

sub FHEMCMS_LogIndexAbort {
    my ($arg) = @_;
    my $request = eval { JSON::PP->new->utf8->decode(decode_base64($arg // '')) };
    return if ($@ || ref($request) ne 'HASH' || !$FHEMCMS_LOG_INDEX_JOB
        || ($request->{token} // '') ne $FHEMCMS_LOG_INDEX_JOB->{token});
    undef($FHEMCMS_LOG_INDEX_JOB);
    FHEMCMS_LogIndexDiscardCandidate($request->{token});
    $FHEMCMS_LOG_INDEX_ERROR = 'Cache-Aufbau hat das Zeitlimit ueberschritten';
    Log3('FHEMCMS', 2, "FHEMCMS: $FHEMCMS_LOG_INDEX_ERROR");
    return;
}

1;
