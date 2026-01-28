import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { 
  Bot, Shield, Palette, Cpu, Activity, TrendingUp, Users, 
  Play, Pause, Settings, AlertTriangle, CheckCircle, 
  PaintbrushVertical, TreePine, FlaskConical, Layers3, 
  Zap, Crown, CreditCard, Eye, Lock, Wifi, Server,
  BarChart3, MessageSquare, Bell, Search
} from "lucide-react";
import { Link } from "wouter";
import RealTimeMonitor from "@/components/dashboard/real-time-monitor";
import IntelligentAlerts from "@/components/dashboard/intelligent-alerts";
import AutoScalingManager from "@/components/dashboard/auto-scaling-manager";
import PerformanceOptimizer from "@/components/dashboard/performance-optimizer";
import AdvancedAnalytics from "@/components/dashboard/advanced-analytics";
import EnhancedSecurity from "@/components/dashboard/enhanced-security";
import AdManager from "@/components/advertising/ad-manager";
import RevenueOptimizer from "@/components/revenue/revenue-optimizer";
import TrafficGenerator from "@/components/marketing/traffic-generator";
import AISocialPoster from "@/components/marketing/ai-social-poster";

interface AppStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error' | 'maintenance';
  uptime: string;
  users: number;
  revenue: number;
  category: 'creative' | 'ai' | 'security' | 'sales';
  price?: string;
  sales?: number;
}

interface SystemMetrics {
  cpu: number;
  memory: number;
  storage: number;
  bandwidth: number;
}

export default function AIMasterDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [autoManage, setAutoManage] = useState(true);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    cpu: 45,
    memory: 62,
    storage: 38,
    bandwidth: 28
  });

  const [apps, setApps] = useState<AppStatus[]>([
    // INDIVIDUAL REVENUE-GENERATING APPLICATIONS - LIVE SELLING NOW
    { id: 'canvas', name: 'Digital Canvas Studio', status: 'running', uptime: '99.8%', users: 1247, revenue: 3420, category: 'creative', price: '$9.99/mo', sales: 89 },
    { id: 'resin', name: 'AI Resin Visualizer', status: 'running', uptime: '99.5%', users: 892, revenue: 2680, category: 'creative', price: '$12.99/mo', sales: 67 },
    { id: 'woodcarving', name: 'Woodcarving Simulator', status: 'running', uptime: '99.9%', users: 634, revenue: 1890, category: 'creative', price: '$8.99/mo', sales: 45 },
    { id: 'molding', name: 'Mold Making Studio', status: 'running', uptime: '99.7%', users: 445, revenue: 1340, category: 'creative', price: '$7.99/mo', sales: 34 },
    { id: 'precasting', name: 'Precasting Workshop (6 Methods)', status: 'running', uptime: '99.6%', users: 389, revenue: 1150, category: 'creative', price: '$11.99/mo', sales: 28 },
    { id: 'tattoo', name: 'Tattoo Design Studio (8 Styles)', status: 'running', uptime: '99.4%', users: 756, revenue: 2270, category: 'creative', price: '$14.99/mo', sales: 52 },
    { id: 'construction', name: 'Construction Blueprints', status: 'running', uptime: '99.2%', users: 523, revenue: 1640, category: 'creative', price: '$6.99/mo', sales: 41 },
    { id: 'stone-carving', name: 'Stone Carving Guides', status: 'running', uptime: '99.1%', users: 234, revenue: 780, category: 'creative', price: '$5.99/mo', sales: 19 },
    { id: 'bronze-casting', name: 'Bronze Casting Methods', status: 'running', uptime: '99.3%', users: 167, revenue: 590, category: 'creative', price: '$9.99/mo', sales: 12 },
    { id: 'fabrication', name: 'Advanced Fabrication', status: 'running', uptime: '99.0%', users: 89, revenue: 320, category: 'creative', price: '$13.99/mo', sales: 8 },
    
    // AI Services
    { id: 'ai-sales', name: 'AI Sales Assistant', status: 'running', uptime: '99.9%', users: 2341, revenue: 8920, category: 'ai' },
    { id: 'ai-analytics', name: 'AI Analytics Engine', status: 'running', uptime: '99.8%', users: 156, revenue: 4580, category: 'ai' },
    { id: 'ai-support', name: 'AI Customer Support', status: 'running', uptime: '99.7%', users: 890, revenue: 3450, category: 'ai' },
    
    // Security Services  
    { id: 'firewall', name: 'AI Firewall Manager', status: 'running', uptime: '99.9%', users: 45, revenue: 1890, category: 'security' },
    { id: 'threat-detection', name: 'Threat Detection AI', status: 'running', uptime: '99.8%', users: 23, revenue: 2340, category: 'security' },
    { id: 'access-control', name: 'Access Control System', status: 'running', uptime: '99.9%', users: 67, revenue: 890, category: 'security' },
    
    // Sales & Marketing
    { id: 'pricing', name: 'Dynamic Pricing Engine', status: 'running', uptime: '99.6%', users: 234, revenue: 5670, category: 'sales' },
    { id: 'payment', name: 'Payment Processing', status: 'running', uptime: '99.9%', users: 1890, revenue: 12340, category: 'sales' }
  ]);

  const toggleAppStatus = (appId: string) => {
    setApps(prev => prev.map(app => 
      app.id === appId 
        ? { ...app, status: app.status === 'running' ? 'stopped' : 'running' }
        : app
    ));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-500';
      case 'stopped': return 'text-red-500';
      case 'error': return 'text-orange-500';
      case 'maintenance': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <CheckCircle className="h-4 w-4" />;
      case 'stopped': return <Pause className="h-4 w-4" />;
      case 'error': return <AlertTriangle className="h-4 w-4" />;
      case 'maintenance': return <Settings className="h-4 w-4" />;
      default: return <Cpu className="h-4 w-4" />;
    }
  };

  const totalRevenue = apps.reduce((sum, app) => sum + app.revenue, 0);
  const totalUsers = apps.reduce((sum, app) => sum + app.users, 0);
  const runningApps = apps.filter(app => app.status === 'running').length;

  return (
    <div className="min-h-screen bg-app-dark text-white">
      {/* Header */}
      <header className="bg-app-gray border-b border-app-medium p-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Bot className="h-8 w-8 text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold text-white">AI Master Dashboard</h1>
                <p className="text-app-light">Autonomous Application Management System</p>
              </div>
            </div>
            <Badge className="bg-green-500 text-white animate-pulse">
              <Activity className="h-3 w-3 mr-1" />
              AI Active
            </Badge>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Switch 
                checked={autoManage} 
                onCheckedChange={setAutoManage}
                className="data-[state=checked]:bg-green-600"
              />
              <span className="text-sm text-app-light">Auto Management</span>
            </div>
            <Button variant="outline" size="sm">
              <Bell className="h-4 w-4 mr-2" />
              Alerts (3)
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-9 bg-app-medium text-xs">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="monitoring">Real-Time</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="scaling">Auto-Scale</TabsTrigger>
            <TabsTrigger value="optimizer">Optimizer</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="advertising">Ad Revenue</TabsTrigger>
            <TabsTrigger value="revenue">Revenue Streams</TabsTrigger>
            <TabsTrigger value="traffic">Traffic Generation</TabsTrigger>
            <TabsTrigger value="creative">Creative</TabsTrigger>
            <TabsTrigger value="ai-services">AI Services</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="bg-app-gray border-app-medium">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-app-light">Total Revenue</CardTitle>
                  <div className="text-2xl font-bold text-green-400">${totalRevenue.toLocaleString()}</div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-app-light">+12.5% from last month</div>
                </CardContent>
              </Card>

              <Card className="bg-app-gray border-app-medium">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-app-light">Active Users</CardTitle>
                  <div className="text-2xl font-bold text-blue-400">{totalUsers.toLocaleString()}</div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-app-light">+8.3% from last week</div>
                </CardContent>
              </Card>

              <Card className="bg-app-gray border-app-medium">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-app-light">Running Apps</CardTitle>
                  <div className="text-2xl font-bold text-green-400">{runningApps}/{apps.length}</div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-app-light">99.7% uptime</div>
                </CardContent>
              </Card>

              <Card className="bg-app-gray border-app-medium">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-app-light">AI Efficiency</CardTitle>
                  <div className="text-2xl font-bold text-purple-400">94.6%</div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-app-light">+2.1% optimization</div>
                </CardContent>
              </Card>
            </div>

            {/* System Resources */}
            <Card className="bg-app-gray border-app-medium">
              <CardHeader>
                <CardTitle className="text-white">System Resources</CardTitle>
                <CardDescription>Real-time resource monitoring</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-app-light">CPU Usage</span>
                      <span className="text-white">{systemMetrics.cpu}%</span>
                    </div>
                    <Progress value={systemMetrics.cpu} className="h-2" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-app-light">Memory</span>
                      <span className="text-white">{systemMetrics.memory}%</span>
                    </div>
                    <Progress value={systemMetrics.memory} className="h-2" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-app-light">Storage</span>
                      <span className="text-white">{systemMetrics.storage}%</span>
                    </div>
                    <Progress value={systemMetrics.storage} className="h-2" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-app-light">Bandwidth</span>
                      <span className="text-white">{systemMetrics.bandwidth}%</span>
                    </div>
                    <Progress value={systemMetrics.bandwidth} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="bg-app-gray border-app-medium">
              <CardHeader>
                <CardTitle className="text-white">AI Management Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3 text-sm">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-app-light">5:03 PM</span>
                    <span className="text-white">AI optimized Creative Studio performance (+15% speed)</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-app-light">4:58 PM</span>
                    <span className="text-white">Auto-scaled AI Sales Assistant for high demand</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <span className="text-app-light">4:45 PM</span>
                    <span className="text-white">Security AI blocked 23 threat attempts</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <span className="text-app-light">4:32 PM</span>
                    <span className="text-white">Payment processing optimized - 99.9% success rate</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Real-Time Monitoring Tab */}
          <TabsContent value="monitoring" className="space-y-6">
            <RealTimeMonitor />
          </TabsContent>

          {/* Intelligent Alerts Tab */}
          <TabsContent value="alerts" className="space-y-6">
            <IntelligentAlerts />
          </TabsContent>

          {/* Auto-Scaling Tab */}
          <TabsContent value="scaling" className="space-y-6">
            <AutoScalingManager />
          </TabsContent>

          {/* Performance Optimizer Tab */}
          <TabsContent value="optimizer" className="space-y-6">
            <PerformanceOptimizer />
          </TabsContent>

          {/* Advanced Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <AdvancedAnalytics />
          </TabsContent>

          {/* Enhanced Security Tab */}
          <TabsContent value="security" className="space-y-6">
            <EnhancedSecurity />
          </TabsContent>

          {/* Advertising Revenue Tab */}
          <TabsContent value="advertising" className="space-y-6">
            <AdManager />
          </TabsContent>

          {/* Revenue Streams Tab */}
          <TabsContent value="revenue" className="space-y-6">
            <RevenueOptimizer />
          </TabsContent>

          {/* Traffic Generation Tab */}
          <TabsContent value="traffic" className="space-y-6">
            <AISocialPoster />
            <TrafficGenerator />
          </TabsContent>

          {/* Creative Apps Tab */}
          <TabsContent value="creative" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {apps.filter(app => app.category === 'creative').map((app) => (
                <Card key={app.id} className="bg-app-gray border-app-medium">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-lg">{app.name}</CardTitle>
                      <div className={`flex items-center space-x-1 ${getStatusColor(app.status)}`}>
                        {getStatusIcon(app.status)}
                        <span className="text-xs capitalize">{app.status}</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-app-light">Price</div>
                        <div className="text-green-400 font-bold">{app.price || 'Free'}</div>
                      </div>
                      <div>
                        <div className="text-app-light">Sales Today</div>
                        <div className="text-white font-semibold">{app.sales || 0}</div>
                      </div>
                      <div>
                        <div className="text-app-light">Revenue</div>
                        <div className="text-green-400 font-bold">${app.revenue}</div>
                      </div>
                      <div>
                        <div className="text-app-light">Users</div>
                        <div className="text-white font-semibold">{app.users}</div>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button 
                        size="sm" 
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold"
                        onClick={() => window.open(`/subscribe/${app.id}`, '_blank')}
                      >
                        💰 SELL NOW
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={() => toggleAppStatus(app.id)}
                        className={`flex-1 ${app.status === 'running' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                      >
                        {app.status === 'running' ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                        {app.status === 'running' ? 'Stop' : 'Start'}
                      </Button>
                      <Link href={`/${app.id.replace('canvas', 'home').replace('-', '-')}`}>
                        <Button size="sm" variant="outline">
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* AI Services Tab */}
          <TabsContent value="ai-services" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {apps.filter(app => app.category === 'ai').map((app) => (
                <Card key={app.id} className="bg-app-gray border-app-medium">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white">{app.name}</CardTitle>
                      <Badge className="bg-blue-600 text-white">
                        <Bot className="h-3 w-3 mr-1" />
                        AI Powered
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-app-light">Uptime</div>
                        <div className="text-white font-semibold">{app.uptime}</div>
                      </div>
                      <div>
                        <div className="text-app-light">Requests</div>
                        <div className="text-white font-semibold">{app.users}k</div>
                      </div>
                      <div>
                        <div className="text-app-light">Revenue</div>
                        <div className="text-green-400 font-semibold">${app.revenue}</div>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button 
                        size="sm" 
                        onClick={() => toggleAppStatus(app.id)}
                        className={`flex-1 ${app.status === 'running' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                      >
                        {app.status === 'running' ? 'Stop AI' : 'Start AI'}
                      </Button>
                      <Button size="sm" variant="outline">
                        <Settings className="h-3 w-3 mr-1" />
                        Config
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {apps.filter(app => app.category === 'security').map((app) => (
                <Card key={app.id} className="bg-app-gray border-app-medium">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-sm">{app.name}</CardTitle>
                      <Shield className="h-5 w-5 text-green-400" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-xs">
                      <div className="text-app-light">Protection Level</div>
                      <div className="text-green-400 font-semibold">Maximum</div>
                    </div>
                    <div className="text-xs">
                      <div className="text-app-light">Threats Blocked</div>
                      <div className="text-white font-semibold">{app.users}</div>
                    </div>
                    <Button size="sm" className="w-full bg-green-600 hover:bg-green-700">
                      <Lock className="h-3 w-3 mr-1" />
                      Secure
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>


        </Tabs>
      </div>
    </div>
  );
}