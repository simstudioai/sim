from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="simstudio-sdk",
    version="0.1.0",
    author="Sim Studio",
    author_email="support@simstudio.ai",
    description="Sim Studio SDK - Execute workflows programmatically",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/simstudioai/sim",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
    python_requires=">=3.8",
    install_requires=[
        "requests>=2.25.0",
        "typing-extensions>=4.0.0; python_version<'3.10'",
    ],
    extras_require={
        "dev": [
            "pytest>=6.0.0",
            "pytest-asyncio>=0.18.0",
            "black>=22.0.0",
            "flake8>=4.0.0",
            "mypy>=0.910",
        ],
        "test": [
            "pytest>=6.0.0",
        ],
    },
    keywords=["simstudio", "ai", "workflow", "sdk", "api", "automation"],
    project_urls={
        "Bug Reports": "https://github.com/simstudioai/sim/issues",
        "Source": "https://github.com/simstudioai/sim",
        "Documentation": "https://docs.simstudio.ai",
    },
) 