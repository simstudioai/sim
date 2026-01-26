Class IrisPGWire.Service Extends %RegisteredObject
{

/// Global to store PID of running server
Parameter PIDGlobal = "^IrisPGWire.PID";

/// Global to store server status
Parameter StatusGlobal = "^IrisPGWire.Status";

/// Start iris-pgwire TCP server
/// Called during IPM Activate phase
ClassMethod Start() As %Status
{
    Set tSC = $$$OK
    Try {
        // Check if server is already running
        Set status = ..GetStatus()
        If status = "running" {
            Write !,"⚠️  iris-pgwire server is already running (PID: ", @..#PIDGlobal, ")",!
            Quit
        }

        Write !,"Starting iris-pgwire TCP server on port 5432...",!

        // Get Python installation directory
        Set libdir = ##class(%Library.File).NormalizeDirectory($SYSTEM.Util.InstallDirectory() _ "mgr/python/")
        Set packageDir = ##class(%Library.File).NormalizeDirectory(libdir _ "iris-pgwire/")

        // Verify package exists
        If '##class(%Library.File).DirectoryExists(packageDir) {
            Set tSC = $$$ERROR($$$GeneralError, "iris-pgwire package not found at: " _ packageDir)
            Quit
        }

        // Start server via irispython in background
        // Use nohup to detach from terminal and redirect output to log
        Set logFile = ##class(%Library.File).NormalizeDirectory($SYSTEM.Util.InstallDirectory() _ "mgr/iris-pgwire.log")

        // Build command to start server
        Set cmd = "nohup /usr/irissys/bin/irispython -m iris_pgwire.server > """ _ logFile _ """ 2>&1 & echo $!"

        Write "Executing: ", cmd,!

        // Start server and capture PID
        Set pipe = ##class(%Library.Pipe).Open(cmd, "r")
        Set pid = pipe.Read()
        Do pipe.Close()

        // Verify PID is numeric
        If pid '= +pid {
            Set tSC = $$$ERROR($$$GeneralError, "Failed to start server - invalid PID: " _ pid)
            Quit
        }

        // Store PID
        Set @..#PIDGlobal = pid
        Set @..#StatusGlobal = "running"

        Write !,"✅ iris-pgwire server started successfully",!
        Write "   PID: ", pid,!
        Write "   Log: ", logFile,!
        Write "   Port: 5432",!

        // Wait a moment and verify process is still running
        Hang 1
        Set running = ..IsProcessRunning(pid)

        If 'running {
            Set tSC = $$$ERROR($$$GeneralError, "Server process died immediately after start. Check log: " _ logFile)
            Kill @..#PIDGlobal
            Set @..#StatusGlobal = "stopped"
            Quit
        }

        Write !,"✅ Server verified running",!

    } Catch ex {
        Set tSC = ex.AsStatus()
        Write !,"❌ Error starting server: ", $SYSTEM.Status.GetErrorText(tSC),!
    }

    Quit tSC
}

/// Stop iris-pgwire TCP server gracefully
/// Called during IPM Deactivate phase
ClassMethod Stop() As %Status
{
    Set tSC = $$$OK
    Try {
        // Check if server is running
        Set status = ..GetStatus()
        If status '= "running" {
            Write !,"ℹ️  iris-pgwire server is not running",!
            Quit
        }

        Set pid = @..#PIDGlobal

        Write !,"Stopping iris-pgwire server (PID: ", pid, ")...",!

        // Send SIGTERM for graceful shutdown
        Set cmd = "kill -TERM " _ pid
        Set result = $ZF(-1, cmd)

        If result '= 0 {
            Write !,"⚠️  SIGTERM failed, trying SIGKILL...",!
            Set cmd = "kill -KILL " _ pid
            Set result = $ZF(-1, cmd)
        }

        // Wait for process to exit (up to 10 seconds)
        Set timeout = 10
        For i=1:1:timeout {
            If '..IsProcessRunning(pid) {
                Quit
            }
            Hang 1
        }

        // Verify stopped
        If ..IsProcessRunning(pid) {
            Set tSC = $$$ERROR($$$GeneralError, "Failed to stop server - process still running after " _ timeout _ " seconds")
            Quit
        }

        // Clear PID and status
        Kill @..#PIDGlobal
        Set @..#StatusGlobal = "stopped"

        Write !,"✅ iris-pgwire server stopped successfully",!

    } Catch ex {
        Set tSC = ex.AsStatus()
        Write !,"❌ Error stopping server: ", $SYSTEM.Status.GetErrorText(tSC),!
    }

    Quit tSC
}

/// Get current server status
/// Returns: "running", "stopped", or "unknown"
ClassMethod GetStatus() As %String
{
    // Check if PID exists
    If '$Data(@..#PIDGlobal) {
        Quit "stopped"
    }

    Set pid = @..#PIDGlobal

    // Verify process is actually running
    If ..IsProcessRunning(pid) {
        Quit "running"
    } Else {
        // PID exists but process is dead - clean up
        Kill @..#PIDGlobal
        Set @..#StatusGlobal = "stopped"
        Quit "stopped"
    }
}

/// Check if a process is running
/// Returns: 1 if running, 0 if not
ClassMethod IsProcessRunning(pid As %Integer) As %Boolean
{
    // Use kill -0 to check if process exists (doesn't actually send signal)
    Set cmd = "kill -0 " _ pid _ " 2>/dev/null"
    Set result = $ZF(-1, cmd)

    // Exit code 0 = process exists
    // Exit code 1 = process does not exist
    Quit (result = 0)
}

/// Restart server (stop then start)
ClassMethod Restart() As %Status
{
    Set tSC = ..Stop()
    If $$$ISERR(tSC) {
        Quit tSC
    }

    // Wait a moment before restarting
    Hang 2

    Set tSC = ..Start()
    Quit tSC
}

/// Display server status information
ClassMethod ShowStatus()
{
    Set status = ..GetStatus()

    Write !,"iris-pgwire Server Status",!
    Write "========================",!
    Write "Status: ", status,!

    If status = "running" {
        Set pid = @..#PIDGlobal
        Write "PID: ", pid,!
        Write "Port: 5432",!

        // Try to read log tail
        Set logFile = ##class(%Library.File).NormalizeDirectory($SYSTEM.Util.InstallDirectory() _ "mgr/iris-pgwire.log")
        If ##class(%Library.File).Exists(logFile) {
            Write !,"Recent log entries:",!
            Set cmd = "tail -n 10 """ _ logFile _ """"
            Do $ZF(-1, cmd)
        }
    }

    Write !
}

}
