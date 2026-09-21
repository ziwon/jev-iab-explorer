import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('extract_youtube', Path(__file__).parents[1]/'scripts/extract_youtube.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExtractorTests(unittest.TestCase):
    def test_id(self):
        self.assertEqual(module.video_id('abcDE_12-34'), 'abcDE_12-34')
    def test_watch(self):
        self.assertEqual(module.video_id('https://www.youtube.com/watch?v=abcDE_12-34'), 'abcDE_12-34')
    def test_short(self):
        self.assertEqual(module.video_id('https://youtu.be/abcDE_12-34'), 'abcDE_12-34')
    def test_shorts(self):
        self.assertEqual(module.video_id('https://youtube.com/shorts/abcDE_12-34'), 'abcDE_12-34')
    def test_ssrf(self):
        with self.assertRaises(ValueError): module.video_id('https://127.0.0.1/internal')
    def test_spoofed_host(self):
        with self.assertRaises(ValueError): module.video_id('https://youtube.com.evil.test/watch?v=abcDE_12-34')
    def test_credentials(self):
        with self.assertRaises(ValueError): module.video_id('https://a:b@youtube.com/watch?v=abcDE_12-34')
    def test_playlist(self):
        with self.assertRaises(ValueError): module.video_id('https://youtube.com/playlist?list=anything')
    def test_insecure(self):
        with self.assertRaises(ValueError): module.video_id('http://youtube.com/watch?v=abcDE_12-34')

if __name__ == '__main__': unittest.main()
