// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;


//### 1.  :white_check_mark: 创建一个名为Voting的合约，包含以下功能：
//- 一个mapping来存储候选人的得票数
//- 一个vote函数，允许用户投票给某个候选人
//- 一个getVotes函数，返回某个候选人的得票数
//- 一个resetVotes函数，重置所有候选人的得票数

contract Voting {
    address public immutable owner;

    mapping(string => uint256) public votes;
    mapping(string => bool) public isCandidate;
    string[] private _candidateList;
    mapping(address => bool) public hasVoted;
    uint256 public totalVotes;

    event Voted(address indexed voter, string candidate, uint256 newCount);
    event CandidateAdded(string candidate);
    event VoteReset(address indexed operator);

    modifier onlyOwner {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    constructor(string[] memory initialCandidates) {
        owner = msg.sender;
        for (uint256 i = 0; i < initialCandidates.length; i++) {
            _addCandidate(initialCandidates[i]);
        }
    }

    function addCandidate(string calldata candidate) external onlyOwner {
        _addCandidate(candidate);
    }

    function vote(string calldata candidate) external {
        require(!hasVoted[msg.sender], "You have already voted");
        require(isCandidate[candidate], "no such candidate");

        hasVoted[msg.sender] = true;
        votes[candidate]+=1;
        totalVotes+=1;
        emit Voted(msg.sender, candidate, votes[candidate]);
    }

    function resetVotes() external onlyOwner {
        for (uint256 i = 0; i < _candidateList.length; i++) {
            votes[_candidateList[i]] = 0;
        }
        totalVotes = 0;

        emit VoteReset(msg.sender);
    }

    function getVotes(string calldata candidate) external view returns (uint256) {
        return votes[candidate];
    }

    function getCandidates() external view returns (string[] memory) {
        return _candidateList;
    }

    function candidateCount() external view returns (uint256) {
        return _candidateList.length;
    }

    function _addCandidate(string memory candidate) internal {
        require(bytes(candidate).length > 0, "Candidate name cannot be empty");
        require(!isCandidate[candidate], "Candidate already exists");
        isCandidate[candidate] = true;
        _candidateList.push(candidate);
        emit CandidateAdded(candidate);
    }

}