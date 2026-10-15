"""Verify the actual signed app bundle and launch it on a matching Mac runner."""
import pathlib
import platform
import subprocess
import tempfile

apps = list(pathlib.Path("release").glob("mac*/FloatCode.app"))
assert len(apps) == 1, f"Expected one packaged app, got {apps}"
app = apps[0].resolve()
subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)], check=True)
binary = app / "Contents/MacOS/FloatCode"
architectures = subprocess.check_output(["lipo", "-archs", str(binary)], text=True)
assert platform.machine() in architectures, f"Runner {platform.machine()} cannot test {architectures}"
with tempfile.TemporaryFile(mode="w+") as log:
    process = subprocess.Popen([str(binary)], stdout=log, stderr=subprocess.STDOUT)
    try:
        process.wait(timeout=8)
        log.seek(0)
        raise RuntimeError(f"Packaged app exited at startup ({process.returncode}):\n{log.read()}")
    except subprocess.TimeoutExpired:
        print(f"PASS: signed FloatCode bundle stayed running on {platform.machine()}")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
