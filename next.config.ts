import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/import': ['./scripts/read_xlsx.py'],
    '/api/animations/[id]/production/run': ['./integrations/blender/process_animation.py', './integrations/blender/encode_gif.cjs'],
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] }];
  },
};

export default nextConfig;
