import { useState, useEffect } from 'react';
import { ServerConfig } from '../hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  createAgent: (name: string, description?: string, initialConfig?: Record<string, ServerConfig>) => void;
}

export function CreateAgentModal({ isOpen, onClose, createAgent }: CreateAgentModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    prompt?: string;
    servers?: string;
  }>({});

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setPrompt('');
    setErrors({});
  };






  const validateForm = () => {
    const newErrors: {
      name?: string;
      prompt?: string;
      servers?: string;
    } = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!prompt.trim()) {
      newErrors.prompt = 'Prompt is required';
    }

    // Check if at least one server URL is provided


    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Just update the handleSubmit function to use the passed createAgent prop
  const handleSubmit = () => {
    if (!validateForm()) return;

    // Filter out empty server URLs

    // Create config object with SSE servers

    // Create the agent using the prop
    createAgent(name, description);
    
    // Close modal and reset form
    onClose();
    resetForm();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Create New Agent</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          {/* Agent Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">
              Agent Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter agent name"
              className={errors.name ? "border-red-500" : ""}
            />
            {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
          </div>
          
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium">
              Description
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter agent description (optional)"
            />
          </div>
          
          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt" className="text-sm font-medium">
              System Prompt <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter instructions for the agent"
              rows={4}
              className={errors.prompt ? "border-red-500" : ""}
            />
            {errors.prompt && <p className="text-sm text-red-500">{errors.prompt}</p>}
          </div>
          
          {/* MCP Server URLs */}
          {/* <div className="space-y-2">
            <Label className="text-sm font-medium">
              MCP Server URLs <span className="text-red-500">*</span>
            </Label>
            
            {serverInputs.map((url, index) => (
              <div key={index} className="flex items-center gap-2 mt-2">
                <Input
                  value={url}
                  onChange={(e) => handleServerInputChange(index, e.target.value)}
                  placeholder="https://example.com/mcp"
                  className="flex-1"
                />
                
                {index > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeServerInput(index)}
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            
            {errors.servers && <p className="text-sm text-red-500">{errors.servers}</p>}
            
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addServerInput}
              className="mt-2"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Server
            </Button>
          </div> */}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Create Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}