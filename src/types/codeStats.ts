// 对应 .migration/code-audit/code-stats.json 的双端代码静态审计产物

export interface CodeStatsRepository {
  id: string
  label: string
  path: string
  platform: string
  revision: string
}

export interface CodeStatsModule {
  name: string
  path: string
  kind: string
}

export interface CodeStatsDependency {
  name: string
  version: string
  declarations: Array<{
    path: string
    line_start?: number
    scope?: string
    version?: string
  }>
}

export interface LanguageBucket {
  language: string
  files: number
  lines: number
}

export interface ExtensionBucket {
  extension: string
  files: number
  lines: number
}

export interface CodeStatsCode {
  total_files: number
  total_lines: number
  by_language: LanguageBucket[]
  other_extensions: ExtensionBucket[]
  skipped_binary: Array<{ extension: string; files: number }>
  scanned_extensions: string[]
  excluded_patterns: string[]
}

export interface OversizedFile {
  path: string
  lines: number
}

export interface CodeStatsSide {
  modules: CodeStatsModule[]
  module_count: number
  third_party_dependencies: CodeStatsDependency[]
  third_party_dependency_count: number
  native_libraries: unknown[]
  native_library_count: number
  code: CodeStatsCode
  oversized_files: OversizedFile[]
}

export interface CodeStatsComparison {
  oversized: { android_count: number; harmony_count: number }
  modules: { android: number; harmony: number }
  third_party_dependencies: { android: number; harmony: number }
  native_libraries: { android: number; harmony: number }
  total_lines: { android: number; harmony: number }
}

export interface CodeStats {
  schema_version: string
  title: string
  language: string
  generated_by: string
  generated_at: string
  thresholds: { oversized_file_lines: number }
  repositories: CodeStatsRepository[]
  sides: Record<'android' | 'harmony', CodeStatsSide>
  notes: string[]
  comparison: CodeStatsComparison
}
