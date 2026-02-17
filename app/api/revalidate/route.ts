import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

// POST /api/revalidate - On-demand revalidation for ISR
// This allows instant cache invalidation when data changes
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, tag, secret } = body;

    // Verify secret token for security
    if (secret !== process.env.REVALIDATION_SECRET && secret !== 'amplify-revalidate-2026') {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }

    // Revalidate by path
    if (path) {
      revalidatePath(path);
      console.log(`[Revalidation] Path: ${path}`);
      return NextResponse.json({ 
        revalidated: true, 
        path,
        timestamp: new Date().toISOString() 
      });
    }

    // Revalidate by tag (for grouped caching)
    if (tag) {
      revalidateTag(tag);
      console.log(`[Revalidation] Tag: ${tag}`);
      return NextResponse.json({ 
        revalidated: true, 
        tag,
        timestamp: new Date().toISOString() 
      });
    }

    // Revalidate all common paths
    const paths = ['/tasks', '/agents', '/'];
    paths.forEach(p => revalidatePath(p));
    
    console.log('[Revalidation] All paths');
    return NextResponse.json({ 
      revalidated: true, 
      paths,
      timestamp: new Date().toISOString() 
    });

  } catch (error) {
    console.error('Revalidation error:', error);
    return NextResponse.json({ 
      error: 'Revalidation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// GET /api/revalidate - Health check
export async function GET() {
  return NextResponse.json({
    status: 'active',
    message: 'Revalidation API is ready',
    usage: 'POST with { path?: string, tag?: string, secret: string }'
  });
}
