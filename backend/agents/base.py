"""
Base Agent class - Common functionality for all agents
"""

from abc import ABC, abstractmethod

from ..services.llm_service import LLMService


class BaseAgent(ABC):
    """Abstract base class for all agents"""

    def __init__(self, llm_service: LLMService):
        self.llm = llm_service

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """Return the system prompt for this agent"""
        pass
