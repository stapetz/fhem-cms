package main;

use strict;
use warnings;
use File::Basename qw(basename dirname);
use File::Spec;
use File::Temp qw(tempfile);
use IO::Uncompress::Gunzip ();
use JSON::PP ();
use Time::Local ();

our $FHEMCMS_LOG_INDEX_MAX_PAIRS = 250000;
our $FHEMCMS_LOG_INDEX_MAX_LINE_BYTES = 1048576;
our $FHEMCMS_LOG_INDEX_MAX_BYTES = 16777216;

sub FHEMCMS_LogIndexDiscoverFiles {
    my ($log, $attributes, $logdir) = @_;
    return (undef, 'Ungueltige FileLog-Konfiguration')
        if (ref($log) ne 'HASH' || ($log->{TYPE} // '') ne 'FileLog'
            || ref($attributes) ne 'HASH' || !defined($log->{logfile})
            || ref($log->{logfile}) || !defined($logdir) || ref($logdir));
    return (undef, 'FileLog mit archivecmd oder outputFormat wird nicht unterstuetzt')
        if (($attributes->{archivecmd} // '') ne '' || ($attributes->{outputFormat} // '') ne '');
    my $pattern = $log->{logfile};
    $pattern =~ s/%L/$logdir/g;
    return (undef, 'Ungueltiger FileLog-Pfad') if ($pattern =~ /[\x00-\x1f\x7f]/);
    my $dir = dirname($pattern);
    return (undef, 'Zeitabhaengige FileLog-Verzeichnisse werden nicht unterstuetzt')
        if ($dir =~ /%/);
    my $filename = basename($pattern);
    my $regexp = '';
    while (length($filename)) {
        if ($filename =~ s/\A%([YGymdHMSwjuUWV])//) {
            my $wildcard = $1;
            $regexp .= $wildcard =~ /[YG]/ ? '[0-9]{4}'
                : $wildcard eq 'j' ? '[0-9]{3}'
                : $wildcard =~ /[wu]/ ? '[0-9]' : '[0-9]{2}';
        } elsif ($filename =~ s/\A([^%]+)//) {
            $regexp .= quotemeta($1);
        } else {
            return (undef, 'Unbekannter FileLog-Zeitplatzhalter');
        }
    }
    my @dirs = ($dir);
    if (defined($attributes->{archivedir}) && $attributes->{archivedir} ne '') {
        my $archive = $attributes->{archivedir};
        return (undef, 'Ungueltiges FileLog-Archivverzeichnis')
            if (ref($archive) || $archive =~ /[%\x00-\x1f\x7f]/);
        push(@dirs, $archive) if ($archive ne $dir);
    }
    my %files;
    for my $path (@dirs) {
        return (undef, 'FileLog-Verzeichnis ist nicht lesbar') if (!-d $path);
        my $dh;
        opendir($dh, $path) or return (undef, 'FileLog-Verzeichnis ist nicht lesbar');
        while (defined(my $entry = readdir($dh))) {
            next if ($entry !~ /\A(?:$regexp)(?:\.gz)?\z/);
            my $file = File::Spec->catfile($path, $entry);
            if (-l $file || !-f $file) {
                closedir($dh);
                return (undef, 'FileLog-Datei ist kein regulaeres File');
            }
            $files{$file} = 1;
            if (keys(%files) > 10000) {
                closedir($dh);
                return (undef, 'Zu viele FileLog-Dateien');
            }
        }
        return (undef, 'FileLog-Verzeichnis konnte nicht geschlossen werden') if (!closedir($dh));
    }
    return ([sort keys %files], undef);
}

sub FHEMCMS_LogIndexBuild {
    my ($logs, $attributes, $logdir, $now, $previous) = @_;
    return (undef, 'Ungueltige Logquellen') if (ref($logs) ne 'ARRAY'
        || ref($attributes) ne 'HASH' || !defined($now) || $now !~ /\A\d{1,10}\z/);
    my $cache = {version => 1, builtAt => $now + 0,
        sources => {dblog => {}, filelog => {}}, errors => {dblog => {}, filelog => {}}};
    for my $log (@{$logs}) {
        return (undef, 'Ungueltige Logquelle') if (ref($log) ne 'HASH'
            || !FHEMCMS_ValidName($log->{NAME})
            || ($log->{TYPE} // '') !~ /\A(?:DbLog|FileLog)\z/);
        my $kind = $log->{TYPE} eq 'DbLog' ? 'dblog' : 'filelog';
        return (undef, 'Doppelte Logquelle') if (exists($cache->{sources}{$kind}{$log->{NAME}}));
        my ($index, $error);
        if ($kind eq 'dblog') {
            ($index, $error) = FHEMCMS_LogIndexDb($log);
        } else {
            my ($files, $fileError) = FHEMCMS_LogIndexDiscoverFiles(
                $log, $attributes->{$log->{NAME}} // {}, $logdir);
            if (defined($fileError)) {
                $error = $fileError;
            } else {
                ($index, $error) = FHEMCMS_LogIndexFiles($files);
            }
        }
        if (defined($error)) {
            $cache->{errors}{$kind}{$log->{NAME}} = $error;
            my $old = ref($previous) eq 'HASH' && ref($previous->{sources}) eq 'HASH'
                && ref($previous->{sources}{$kind}) eq 'HASH'
                ? $previous->{sources}{$kind}{$log->{NAME}} : undef;
            $cache->{sources}{$kind}{$log->{NAME}} = $old if (ref($old) eq 'HASH');
            next;
        }
        $cache->{sources}{$kind}{$log->{NAME}} = $index;
    }
    my $error = FHEMCMS_LogIndexValidate($cache);
    return (undef, $error) if (defined($error));
    return ($cache, undef);
}

sub FHEMCMS_LogIndexSelect {
    my ($cache, $kind, $logs, $device) = @_;
    return (undef, 'Ungueltige Cache-Abfrage') if (ref($cache) ne 'HASH'
        || ($kind // '') !~ /\A(?:dblog|filelog)\z/ || ref($logs) ne 'ARRAY'
        || !FHEMCMS_ValidName($device) || ref($cache->{sources}) ne 'HASH'
        || ref($cache->{sources}{$kind}) ne 'HASH');
    my (%readings, @warnings);
    for my $name (@{$logs}) {
        return (undef, 'Ungueltige Logquelle') if (!FHEMCMS_ValidName($name));
        if (ref($cache->{errors}) eq 'HASH' && ref($cache->{errors}{$kind}) eq 'HASH'
            && defined($cache->{errors}{$kind}{$name})) {
            my $message = "Logquelle $name: $cache->{errors}{$kind}{$name}; Cache moeglicherweise veraltet";
            push(@warnings, $message);
            next if (ref($cache->{sources}{$kind}{$name}) ne 'HASH');
        }
        my $source = $cache->{sources}{$kind}{$name};
        return (undef, "Logquelle $name fehlt im Cache") if (ref($source) ne 'HASH');
        my $values = $source->{$device};
        next if (!defined($values));
        return (undef, 'Ungueltiges Cache-Device') if (ref($values) ne 'HASH');
        $readings{$_} = 1 for keys %{$values};
    }
    return ([sort keys %readings], undef, \@warnings);
}

sub FHEMCMS_LogIndexNextBuild {
    my ($now) = @_;
    return undef if (!defined($now) || ref($now) || $now !~ /\A\d+(?:\.\d+)?\z/);
    my @local = localtime($now);
    my $next = Time::Local::timelocal(0, 0, 3, $local[3], $local[4], $local[5]);
    if ($next <= $now) {
        # Noon is outside DST transitions; use its calendar date rather than adding 24 hours to 03:00.
        my $noon = Time::Local::timelocal(0, 0, 12, $local[3], $local[4], $local[5]);
        my @tomorrow = localtime($noon + 86400);
        $next = Time::Local::timelocal(0, 0, 3, $tomorrow[3], $tomorrow[4], $tomorrow[5]);
    }
    return $next;
}

sub FHEMCMS_LogIndexDb {
    my ($log) = @_;
    return (undef, 'Ungueltiges DbLog-Device')
        if (ref($log) ne 'HASH' || ($log->{TYPE} // '') ne 'DbLog');
    return (undef, 'DbLog-Verbindungsschnittstelle nicht verfuegbar')
        if (!defined(&_DbLog_getNewDBHandle));
    my $table = ref($log->{HELPER}) eq 'HASH' ? $log->{HELPER}{TH} : undef;
    return (undef, 'DbLog-History-Tabelle ist ungueltig')
        if (!defined($table) || ref($table)
            || $table !~ /\A[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\z/);

    my $dbh;
    my %index;
    my $error;
    {
        local $@;
        my $ok = eval {
            $dbh = _DbLog_getNewDBHandle($log);
            die "connection\n" if (!$dbh);
            my $quoted = join('.', map { $dbh->quote_identifier($_) } split(/\./, $table));
            my $sth = $dbh->prepare("SELECT DEVICE, READING FROM $quoted GROUP BY DEVICE, READING");
            die "prepare\n" if (!$sth || !$sth->execute());
            my $count = 0;
            while (my $row = $sth->fetchrow_arrayref()) {
                die "limit\n" if (++$count > $FHEMCMS_LOG_INDEX_MAX_PAIRS);
                my ($device, $reading) = @{$row};
                next if (!defined($device) || !defined($reading) || ref($device) || ref($reading));
                next if (!FHEMCMS_ValidName($device) || !FHEMCMS_ValidName($reading));
                $index{$device}{$reading} = 1;
            }
            die "fetch\n" if ($sth->err);
            $sth->finish() or die "finish\n";
            1;
        };
        $error = $@ eq "limit\n" ? 'Zu viele DbLog-Device-Reading-Paare'
            : 'DbLog-Index konnte nicht gelesen werden' if (!$ok);
    }
    if ($dbh) {
        local $@;
        my $closed = eval { $dbh->disconnect() };
        $error //= 'DbLog-Verbindung konnte nicht geschlossen werden' if (!$closed || $@);
    }
    return (undef, $error) if (defined($error));
    return (\%index, undef);
}

sub FHEMCMS_LogIndexFiles {
    my ($files) = @_;
    return (undef, 'Ungueltige FileLog-Dateiliste') if (ref($files) ne 'ARRAY');
    my %index;
    my $count = 0;
    for my $file (@{$files}) {
        return (undef, 'Ungueltige FileLog-Datei')
            if (!defined($file) || ref($file) || $file =~ /[\x00-\x1f\x7f]/);
        return (undef, 'FileLog-Datei ist kein regulaeres File')
            if (-l $file || !-f $file);
        my $fh;
        if ($file =~ /\.gz\z/) {
            $fh = IO::Uncompress::Gunzip->new($file, MultiStream => 1, Strict => 1, Transparent => 0);
        } else {
            open($fh, '<:raw', $file);
        }
        return (undef, 'FileLog-Datei konnte nicht geoeffnet werden') if (!$fh);
        my $buffer = '';
        my $scanError;
        while (1) {
            my $chunk = '';
            my $size = $file =~ /\.gz\z/ ? $fh->read($chunk, 65536) : read($fh, $chunk, 65536);
            if (!defined($size) || $size < 0) {
                $scanError = 'FileLog-Datei konnte nicht vollstaendig gelesen werden';
                last;
            }
            $buffer .= $chunk;
            while ($buffer =~ s/\A([^\n]*)\n//) {
                my $line = $1;
                if (length($line) > $FHEMCMS_LOG_INDEX_MAX_LINE_BYTES) {
                    $scanError = 'FileLog-Zeile ist zu gross';
                    last;
                }
                next if ($line !~ /\A\d{4}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+([A-Za-z0-9_.-]{1,128})\s+([A-Za-z0-9_.-]{1,128}):(?:\s|\z)/);
                my ($device, $reading) = ($1, $2);
                next if (!FHEMCMS_ValidName($device) || !FHEMCMS_ValidName($reading));
                next if ($index{$device}{$reading});
                if (++$count > $FHEMCMS_LOG_INDEX_MAX_PAIRS) {
                    $scanError = 'Zu viele FileLog-Device-Reading-Paare';
                    last;
                }
                $index{$device}{$reading} = 1;
            }
            last if (defined($scanError));
            if (length($buffer) > $FHEMCMS_LOG_INDEX_MAX_LINE_BYTES) {
                $scanError = 'FileLog-Zeile ist zu gross';
                last;
            }
            if (!$size) {
                if (length($buffer)) {
                    $buffer .= "\n";
                    next;
                }
                last;
            }
        }
        my $readError = $file =~ /\.gz\z/ ? $fh->error() : 0;
        my $closed = close($fh);
        return (undef, $scanError) if (defined($scanError));
        return (undef, 'FileLog-Datei konnte nicht vollstaendig gelesen werden')
            if ($readError || !$closed);
    }
    return (\%index, undef);
}

sub FHEMCMS_LogIndexValidate {
    my ($data) = @_;
    return 'Ungueltiges Cache-Format' if (ref($data) ne 'HASH'
        || join(',', sort keys %{$data}) !~ /\AbuiltAt,(?:errors,)?(?:fingerprint,)?sources,version\z/
        || ref($data->{version}) || ($data->{version} // '') ne '1'
        || ref($data->{builtAt}) || ($data->{builtAt} // '') !~ /\A\d{1,10}\z/
        || (exists($data->{fingerprint}) && (ref($data->{fingerprint})
            || ($data->{fingerprint} // '') !~ /\A[0-9a-f]{64}\z/))
        || ref($data->{sources}) ne 'HASH'
        || join(',', sort keys %{$data->{sources}}) ne 'dblog,filelog');
    if (exists($data->{errors})) {
        return 'Ungueltige Cache-Fehler' if (ref($data->{errors}) ne 'HASH'
            || join(',', sort keys %{$data->{errors}}) ne 'dblog,filelog');
        for my $kind (qw(dblog filelog)) {
            return 'Ungueltige Cache-Fehler' if (ref($data->{errors}{$kind}) ne 'HASH');
            for my $name (keys %{$data->{errors}{$kind}}) {
                my $error = $data->{errors}{$kind}{$name};
                return 'Ungueltiger Cache-Fehler' if (!FHEMCMS_ValidName($name)
                    || !defined($error) || ref($error) || $error !~ /\A[^\x00-\x1f\x7f]{1,256}\z/);
            }
        }
    }
    my $count = 0;
    for my $kind (qw(dblog filelog)) {
        my $logs = $data->{sources}{$kind};
        return 'Ungueltige Cache-Quellen' if (ref($logs) ne 'HASH');
        for my $log (keys %{$logs}) {
            return 'Ungueltige Cache-Quelle' if (!FHEMCMS_ValidName($log) || ref($logs->{$log}) ne 'HASH');
            for my $device (keys %{$logs->{$log}}) {
                my $readings = $logs->{$log}{$device};
                return 'Ungueltiges Cache-Device' if (!FHEMCMS_ValidName($device) || ref($readings) ne 'HASH');
                for my $reading (keys %{$readings}) {
                    return 'Ungueltiges Cache-Reading' if (!FHEMCMS_ValidName($reading)
                        || ref($readings->{$reading}) || ($readings->{$reading} // '') ne '1');
                    return 'Cache enthaelt zu viele Eintraege' if (++$count > $FHEMCMS_LOG_INDEX_MAX_PAIRS);
                }
            }
        }
    }
    return undef;
}

sub FHEMCMS_LogIndexWrite {
    my ($dir, $data, $targetName) = @_;
    return 'Ungueltiges Cache-Verzeichnis' if (!defined($dir) || ref($dir) || -l $dir || !-d $dir);
    $targetName //= 'log-index.json';
    return 'Ungueltiger Cache-Dateiname'
        if (ref($targetName) || $targetName !~ /\A(?:log-index\.json|\.log-index-[0-9a-f]{64}\.json)\z/);
    my $error = FHEMCMS_LogIndexValidate($data);
    return $error if (defined($error));
    my $bytes = JSON::PP->new->utf8->canonical->encode($data);
    return 'Cache ist zu gross' if (length($bytes) > $FHEMCMS_LOG_INDEX_MAX_BYTES);
    my $target = File::Spec->catfile($dir, $targetName);
    return 'Symlink fuer Cache ist nicht erlaubt' if (-l $target);
    my ($out, $tmp);
    {
        local $@;
        my $ok = eval { ($out, $tmp) = tempfile('.log-index-XXXXXXXX', DIR => $dir, UNLINK => 0); 1 };
        return 'Temporaere Cache-Datei konnte nicht angelegt werden' if (!$ok);
    }
    binmode($out, ':raw');
    my $written = print {$out} $bytes;
    my $closed = close($out);
    if (!$written || !$closed || -l $target || !rename($tmp, $target)) {
        unlink($tmp) or Log3('FHEMCMS', 1, 'FHEMCMS: temporaere Cache-Datei konnte nicht entfernt werden');
        return 'Cache konnte nicht gespeichert werden';
    }
    return undef;
}

sub FHEMCMS_LogIndexRead {
    my ($dir) = @_;
    return (undef, 'Ungueltiges Cache-Verzeichnis') if (!defined($dir) || ref($dir) || -l $dir || !-d $dir);
    my $file = File::Spec->catfile($dir, 'log-index.json');
    return (undef, 'Cache-Datei nicht verfuegbar') if (-l $file || !-f $file);
    return (undef, 'Cache ist zu gross') if (-s $file > $FHEMCMS_LOG_INDEX_MAX_BYTES);
    open(my $in, '<:raw', $file) or return (undef, 'Cache konnte nicht geoeffnet werden');
    my $bytes = '';
    my $readError = 0;
    while (length($bytes) <= $FHEMCMS_LOG_INDEX_MAX_BYTES) {
        my $chunk = '';
        my $size = read($in, $chunk, 65536);
        if (!defined($size)) { $readError = 1; last; }
        last if (!$size);
        $bytes .= $chunk;
    }
    my $closed = close($in);
    return (undef, 'Cache konnte nicht gelesen werden') if ($readError || !$closed
        || length($bytes) > $FHEMCMS_LOG_INDEX_MAX_BYTES);
    my $data;
    {
        local $@;
        $data = eval { JSON::PP->new->utf8->decode($bytes) };
        return (undef, 'Cache enthaelt ungueltiges JSON') if ($@);
    }
    my $error = FHEMCMS_LogIndexValidate($data);
    return (undef, $error) if (defined($error));
    return ($data, undef);
}

1;
