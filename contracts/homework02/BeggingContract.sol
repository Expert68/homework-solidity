//SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BeggingContract is ReentrancyGuard {
    address public immutable owner;
    mapping(address => uint256) public donations;
    address[] private _donors;
    mapping(address => bool) private _inList;
    uint256 public totalDonated;
    uint256 public immutable deadline;
    uint256 public constant MIN_DONATION = 0.001 ether;

    event Donation(address donor, uint256 amount,uint256 total, uint256 timestamp);
    event Withdraw(address indexed owner, uint256 amount);
    
    error NotOwner();
    error DonationClosed();
    error DonationTooSmall(uint256 given, uint256 mininum);
    error NothingToWithdraw();
    error TransferFailed();

    modifier onlyOwner() {
        if(msg.sender!=owner) {
            revert NotOwner();
        }
        _;
    }

    modifier beforeDeadline() {
        if(block.timestamp>deadline) {
            revert DonationClosed();
        }
        _;
    }

    //===============================

    constructor(uint256 durationDays) {
        owner=msg.sender;
        deadline=block.timestamp+durationDays*1 days;
    }

    function Donate() external payable beforeDeadline {
        if(msg.value<MIN_DONATION) {
            revert DonationTooSmall(msg.value,MIN_DONATION);
        }
        donations[msg.sender] += msg.value;
        totalDonated += msg.value;

        if(!_inList[msg.sender]) {
            _donors.push(msg.sender);
            _inList[msg.sender]=true;
        }
        emit Donation(msg.sender,msg.value,totalDonated,block.timestamp);
    }

    receive() external payable {
        if (msg.value < MIN_DONATION) revert DonationTooSmall(msg.value, MIN_DONATION);
        if(block.timestamp>deadline) {
            revert DonationClosed();
        }
        donations[msg.sender] += msg.value;
        totalDonated += msg.value;
        if(!_inList[msg.sender]) {
            _donors.push(msg.sender);
            _inList[msg.sender]=true;
        }
        emit Donation(msg.sender,msg.value,totalDonated,block.timestamp);
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 amount=address(this).balance;
        if(amount==0) {
            revert NothingToWithdraw();
        }

        (bool ok, ) = payable(owner).call{value:amount}("");
        if(!ok) {
            revert TransferFailed();
        }
        emit Withdraw(owner,amount);
    }

    function getDonation(address donor) external view returns (uint256) {
        return donations[donor];
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }

    function donorCount() external view returns (uint256) {
        return _donors.length;
    }

     function top3()
        external
        view
        returns (address[3] memory topAddresses, uint256[3] memory topAmounts)
    {
        for (uint256 i = 0; i < _donors.length; i++) {
            address who = _donors[i];
            uint256 amount = donations[who];

            if (amount > topAmounts[0]) {
                topAmounts[2] = topAmounts[1];
                topAddresses[2] = topAddresses[1];
                topAmounts[1] = topAmounts[0];
                topAddresses[1] = topAddresses[0];
                topAmounts[0] = amount;
                topAddresses[0] = who;
            } else if (amount > topAmounts[1]) {
                topAmounts[2] = topAmounts[1];
                topAddresses[2] = topAddresses[1];
                topAmounts[1] = amount;
                topAddresses[1] = who;
            } else if (amount > topAmounts[2]) {
                topAmounts[2] = amount;
                topAddresses[2] = who;
            }
        }
    }

    function timeLeft() external view returns (uint256) {
        if(block.timestamp>=deadline) return 0;
        return deadline - block.timestamp;
    }

}