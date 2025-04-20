"use client";

import React, { useEffect } from 'react'
import { GridPattern } from '../grid-pattern'
import { Button } from '@/components/ui/button'
import { Command, CornerDownLeft } from 'lucide-react'
import HeroWorkflowProvider from '../hero-workflow'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

function Hero() {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        router.push('/login');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  return (
    <section className="min-h-screen pt-36 sm:pt-48 md:pt-56 text-white relative border-b border-[#181818] overflow-hidden">
        <GridPattern 
          x={-5}
          y={-5}
          className='stroke-[#ababab]/5 absolute inset-0 z-0'
          width={90}
          height={90}
        />

        <div className='absolute w-full h-full left-0 top-0'>
          <svg width="1440" height="1306" viewBox="0 0 1440 1306" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g filter="url(#filter0_f_0_1)">
            <path d="M711.366 307.828C711.366 455.088 614.001 574.465 493.895 574.465C373.79 574.465 -376.616 57.9679 -376.616 -89.292C-376.616 -236.552 701.571 -33.8213 821.677 -33.8213C941.782 -33.8213 711.366 160.568 711.366 307.828Z" fill="#0C0C0C"/>
            </g>
            <g filter="url(#filter1_f_0_1)">
            <path d="M795.831 938.853C795.831 1086.11 698.466 1205.49 578.36 1205.49C458.255 1205.49 -210.836 1171.17 -210.836 1023.91C-210.836 876.646 -161.378 527.821 -41.2726 527.821C78.833 527.821 795.831 791.593 795.831 938.853Z" fill="#0C0C0C"/>
            </g>
            <g filter="url(#filter2_f_0_1)">
            <path d="M1042.53 308.232C1366.59 600.92 1216.89 453.832 1495.24 446.422C1538.9 454.833 1613.03 455.233 1560.22 389.542C1494.2 307.427 1515.48 249.429 1432.97 159.965C1350.47 70.5012 1300.23 -20.3926 1175.67 -162.683C1051.12 -304.973 1041.53 -187.679 901.114 -198.798C760.693 -209.917 824.739 -192.26 630.995 14.1974C437.251 220.654 718.46 15.5432 1042.53 308.232Z" fill="#0C0C0C"/>
            </g>
            <g filter="url(#filter3_f_0_1)">
            <path d="M736.58 768.614C302.9 819.672 512.176 803.913 334.417 1018.23C299.328 1045.55 250.203 1101.06 334.417 1104.59C439.685 1109 469.312 1163.21 590.969 1160.06C712.627 1156.91 814.113 1178.97 1003.22 1178.97C1192.32 1178.97 1110.38 1094.5 1211.23 996.169C1312.09 897.835 1256.62 934.395 1228.88 652.63C1201.15 370.864 1170.26 717.555 736.58 768.614Z" fill="#0C0C0C"/>
            </g>
            <defs>
            <filter id="filter0_f_0_1" x="-476.616" y="-242.917" width="1432.97" height="917.382" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix"/>
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
            <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur_0_1"/>
            </filter>
            <filter id="filter1_f_0_1" x="-310.836" y="427.821" width="1206.67" height="877.67" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix"/>
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
            <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur_0_1"/>
            </filter>
            <filter id="filter2_f_0_1" x="467.422" y="-333.739" width="1211.07" height="923.628" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix"/>
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
            <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur_0_1"/>
            </filter>
            <filter id="filter3_f_0_1" x="187.918" y="443.463" width="1181.34" height="835.507" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix"/>
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
            <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur_0_1"/>
            </filter>
            </defs>
          </svg>


        </div>

        <div className="absolute inset-0 z-10 flex items-center justify-center h-full">
           <HeroWorkflowProvider />
        </div>

        <div className="text-center space-y-4 relative z-20 px-4">
          <h1 className="text-5xl md:text-[80px] leading-[1.10] tracking-tight font-semibold animate-fade-up [animation-delay:200ms] opacity-0">
            Build and Deploy
            <br/>
            Agent Workflows
          </h1>

          <p className="text-base md:text-xl text-neutral-400/80 font-normal max-w-3xl mx-auto animate-fade-up leading-[1.5] tracking-normal [animation-delay:400ms] opacity-0">
            Launch agentic workflows with an open source, <br />
            user-friendly environment for devs and agents
          </p>

          <div className="animate-fade-up pt-4 [animation-delay:600ms] opacity-0 translate-y-[-10px]">
            <Button variant={"secondary"} className='bg-[#802fff] font-geist-sans items-center px-7 py-6 text-lg text-neutral-100 font-normal tracking-normal shadow-lg shadow-[#802fff]/30 hover:bg-[#701ffc]'>
                <Link href={"/login"}>
                  Start now
                </Link>

              <div className='flex items-center gap-1 pl-2 opacity-80'>
                <Command size={24}/>
                <CornerDownLeft/>
              </div>
            </Button>
          </div>
        </div>
      </section>
  )
}

export default Hero