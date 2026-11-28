"""Host adapter regression checks. Run with python3 -I tests/test_game_model_tools.py."""

import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest


CLI = Path(__file__).resolve().parents[1] / 'skills/openmotion-game/scripts/game_model_tools.py'


class HostAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / 'authorized'
        self.project.mkdir()

    def refused(self, expected, *args):
        result = subprocess.run([sys.executable, '-I', CLI, *args], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(expected, result.stderr)

    def test_rejects_modified_upstream(self):
        folder = self.root / 'scripts'
        folder.mkdir()
        (folder / 'inventory.py').write_text('raise Exception("executed")')
        self.refused('SHA-256 mismatch', 'inventory', self.project, '--checkout', self.root)

    def test_refuses_nested_and_existing_destinations(self):
        for dest in (self.project / 'out', self.root):
            self.refused('new output directory', 'unity-extract', self.project, '--output', dest)

    def test_refuses_link_in_project(self):
        target = self.root / 'outside'
        target.write_text('{}')
        try:
            (self.project / 'linked').symlink_to(target)
        except OSError:
            self.skipTest('host does not permit symlinks')
        self.refused('Linked input', 'identify', self.project)

    @unittest.skipUnless(os.name == 'posix', 'Linux-style literal backslash filenames')
    def test_collects_linux_uex_filenames_before_cleaning_stage(self):
        collect = runpy.run_path(str(CLI))['collect_uex_export']
        stage = self.root / 'stage'
        stage.mkdir()
        output = self.root / 'delivery'
        rendered = str(stage / 'Content' / 'Cube.glb').replace('/', '\\')
        (self.root / rendered).write_bytes(b'fixture')
        item = {'ok': True, 'files': [rendered]}
        collect(self.root, stage, output, {'data': {'items': [item]}})
        self.assertEqual(item['files'], [str(output / 'Content' / 'Cube.glb')])
        self.assertEqual(Path(item['files'][0]).read_bytes(), b'fixture')


if __name__ == '__main__':
    unittest.main()
