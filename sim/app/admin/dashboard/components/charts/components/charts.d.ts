import { ChartData, ChartOptions } from 'chart.js'
import React from 'react'

export function LineChart({ data, options }: { data: ChartData<'line'>; options?: ChartOptions<'line'> }): React.ReactElement;
export function BarChart({ data, options }: { data: ChartData<'bar'>; options?: ChartOptions<'bar'> }): React.ReactElement; 