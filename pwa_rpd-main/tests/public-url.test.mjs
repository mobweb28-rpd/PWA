import assert from 'node:assert/strict';
import test from 'node:test';
import { publicHttpUrl } from '../src/lib/public-url.ts';

test('reject executable schemes, malformed values and embedded credentials', () => {
  for (const value of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', 'https://user:password@example.com', {}, null, '']) {
    assert.equal(publicHttpUrl(value), '');
  }
});

test('preserve public HTTP(S) links and resolve WordPress relative media URLs', () => {
  assert.equal(publicHttpUrl('https://instagram.com/radioppidunia'), 'https://instagram.com/radioppidunia');
  assert.equal(publicHttpUrl('/wp-content/photo.jpg', 'https://radioppidunia.org/about-us/'), 'https://radioppidunia.org/wp-content/photo.jpg');
  assert.equal(publicHttpUrl('//radioppidunia.org/photo.jpg', 'https://radioppidunia.org/'), 'https://radioppidunia.org/photo.jpg');
});
