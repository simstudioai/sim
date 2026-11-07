import { RouteStatus } from '@/platform/embedded/app/(shell)/_components/route-status/route-status'

export default function BenchmarkLoading() {
  return <RouteStatus title='Benchmark' description='Loading benchmarks…' loading />
}
