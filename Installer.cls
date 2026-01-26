Class IrisPGWire.Installer Extends %RegisteredObject
{

/// Install Python dependencies from requirements.txt via irispip
/// Called during IPM Setup phase
ClassMethod InstallPythonDeps() As %Status
{
    Set tSC = $$$OK
    Try {
        // Get IPM installation directory
        Set libdir = ##class(%Library.File).NormalizeDirectory($SYSTEM.Util.InstallDirectory() _ "mgr/python/")

        // Construct path to requirements.txt in iris-pgwire package
        Set reqPath = ##class(%Library.File).NormalizeDirectory(libdir _ "iris-pgwire/requirements.txt")

        // Verify requirements.txt exists
        If '##class(%Library.File).Exists(reqPath) {
            Set tSC = $$$ERROR($$$GeneralError, "requirements.txt not found at: " _ reqPath)
            Quit
        }

        Write !,"Installing Python dependencies from: ", reqPath,!

        // Run irispip install -r requirements.txt
        // Use $ZF(-100) to suppress output noise
        Set cmd = "/usr/irissys/bin/irispip install -r """ _ reqPath _ """"

        Write "Executing: ", cmd,!

        // Execute pip install
        Set result = $ZF(-1, cmd)

        // Check return code
        If result '= 0 {
            Set tSC = $$$ERROR($$$GeneralError, "irispip install failed with exit code: " _ result)
            Quit
        }

        Write !,"✅ Python dependencies installed successfully",!

    } Catch ex {
        Set tSC = ex.AsStatus()
        Write !,"❌ Error installing Python dependencies: ", $SYSTEM.Status.GetErrorText(tSC),!
    }

    Quit tSC
}

/// Verify Python dependencies are installed
/// Useful for troubleshooting
ClassMethod VerifyDependencies() As %Status
{
    Set tSC = $$$OK
    Try {
        // Test critical imports
        Set pythonCode = "import sys; import intersystems_iris.dbapi._DBAPI; import opentelemetry.api; import pydantic; print('All dependencies OK')"

        Set result = ##class(%SYS.Python).Run(pythonCode)

        If result = "" {
            Set tSC = $$$ERROR($$$GeneralError, "Python dependency verification failed")
        }

    } Catch ex {
        Set tSC = ex.AsStatus()
    }

    Quit tSC
}

}
